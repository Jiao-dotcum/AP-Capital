import { clamp } from './prng.js'
import { UNIVERSE, CASH_RATE, SURPRISE_PP } from './assets.js'

// ————— The paper-trading OMS —————
// The Charter forbids outside money and real-money automation, so the order
// management system trades PAPER only: own notional capital, listed proxies,
// deterministic simulated fills. The shape mirrors a real broker OMS (blotter,
// positions, mark-to-market, reconciliation) and leaves room for an Alpaca- or
// IBKR-paper adapter, but the wired broker is the local paper book — no keys,
// offline, reproducible. Pre-trade compliance can veto an order exactly as the
// Layer-4 risk agent vetoes a trade upstream.

export const START_NAV = 1_000_000 // notional own capital, USD
const PAR = 100 // every proxy is par-normalized to a 100 reference price
const SLIPPAGE_BP = 4 // paper fill slips 4bp against the taker

const CLASS_OF = Object.fromEntries(UNIVERSE.map((a) => [a.id, a.cls]))
const A = Object.fromEntries(UNIVERSE.map((a) => [a.id, a]))

// Pre-trade compliance limits (the Layer-4 function, at the order gate).
export const LIMITS = {
  maxName: 0.25, // single-name notional / NAV
  maxClass: 0.45, // asset-class notional / NAV
  grossCeiling: 1.6, // Σ|notional| / NAV hard ceiling
}

export function initBook(nav = START_NAV) {
  const marks = Object.fromEntries(UNIVERSE.map((a) => [a.id, PAR]))
  return { cash: nav, positions: {}, marks, realized: 0, blotter: [], history: [], seq: 0 }
}

// Deterministic mark step: the factor return (no idiosyncratic noise, so the
// paper book is reproducible), applied to every proxy from the macro reading.
export function markStep(reading) {
  const out = {}
  for (const a of UNIVERSE) out[a.id] = a.er / 12 + SURPRISE_PP * (a.bG * reading.g + a.bI * reading.i)
  return out
}

const notional = (book, id) => (book.positions[id]?.qty ?? 0) * book.marks[id]
export const bookNav = (book) => book.cash + UNIVERSE.reduce((s, a) => s + notional(book, a.id), 0)
const grossOf = (book) => UNIVERSE.reduce((s, a) => s + Math.abs(notional(book, a.id)), 0)

// Target positions from a weight dict (risk-parity weights, fraction of NAV).
// Cash is the residual — never a traded position. Targets are clipped to the
// single-name and class caps up front so a well-formed rebalance is already
// compliant; anything the target can't hold falls to cash (under-deployment
// is the honest cost of concentration limits). preTrade remains the backstop.
export function targetPositions(book, weights) {
  const nav = bookNav(book)
  const notionals = {}
  for (const a of UNIVERSE) {
    if (a.id === 'cash') continue
    const w = weights[a.id] ?? 0
    notionals[a.id] = Math.min(Math.max(w, 0) * nav, LIMITS.maxName * nav)
  }
  // Class caps: scale down every name in an over-cap class proportionally.
  const byClass = {}
  for (const [id, n] of Object.entries(notionals)) byClass[CLASS_OF[id]] = (byClass[CLASS_OF[id]] || 0) + n
  for (const [cls, tot] of Object.entries(byClass)) {
    if (tot > LIMITS.maxClass * nav) {
      const f = (LIMITS.maxClass * nav) / tot
      for (const id of Object.keys(notionals)) if (CLASS_OF[id] === cls) notionals[id] *= f
    }
  }
  const tgt = {}
  for (const a of UNIVERSE) tgt[a.id] = a.id === 'cash' ? 0 : (notionals[a.id] || 0) / book.marks[a.id]
  return tgt
}

// Diff current vs target into orders, largest drift first.
export function planOrders(book, targets) {
  const orders = []
  for (const a of UNIVERSE) {
    if (a.id === 'cash') continue
    const cur = book.positions[a.id]?.qty ?? 0
    const dq = +((targets[a.id] ?? 0) - cur).toFixed(2)
    if (Math.abs(dq * book.marks[a.id]) < 1) continue // ignore sub-$1 drift
    orders.push({ id: a.id, name: a.name, cls: CLASS_OF[a.id], side: dq > 0 ? 'BUY' : 'SELL', qty: Math.abs(dq), price: book.marks[a.id] })
  }
  return orders.sort((x, y) => y.qty * y.price - x.qty * x.price)
}

// Pre-trade compliance: sells always clear (they reduce risk); buys must keep
// single-name, class, and gross within limits, and are halted entirely when
// the risk hardstop is breached upstream.
export function preTrade(order, book, ctx) {
  if (order.side === 'SELL') return { ok: true }
  const nav = bookNav(book)
  if (ctx.ruinBreached) return { ok: false, reason: 'ruin ceiling breached — new risk halted' }
  const addNotional = order.qty * order.price
  const nameAfter = Math.abs(notional(book, order.id) + addNotional)
  if (nameAfter > LIMITS.maxName * nav) return { ok: false, reason: `single-name > ${LIMITS.maxName * 100}% NAV` }
  const classAfter =
    UNIVERSE.filter((a) => a.cls === order.cls).reduce((s, a) => s + notional(book, a.id), 0) + addNotional
  if (classAfter > LIMITS.maxClass * nav) return { ok: false, reason: `${order.cls} class > ${LIMITS.maxClass * 100}% NAV` }
  if (grossOf(book) + addNotional > LIMITS.grossCeiling * nav)
    return { ok: false, reason: `gross > ${LIMITS.grossCeiling}× NAV ceiling` }
  return { ok: true }
}

// Fill a compliant order at a slipped paper price; update cash, position,
// realized P&L; record the blotter entry. Vetoed orders are recorded too.
function fill(book, order) {
  const px = order.price * (1 + (order.side === 'BUY' ? 1 : -1) * SLIPPAGE_BP / 1e4)
  const pos = book.positions[order.id] ?? { qty: 0, avgCost: px }
  const signed = order.side === 'BUY' ? order.qty : -order.qty
  if (order.side === 'BUY') {
    pos.avgCost = (pos.avgCost * pos.qty + px * order.qty) / (pos.qty + order.qty || 1)
    pos.qty += order.qty
  } else {
    book.realized += (px - pos.avgCost) * order.qty
    pos.qty -= order.qty
  }
  book.cash -= signed * px
  if (Math.abs(pos.qty) < 1e-6) delete book.positions[order.id]
  else book.positions[order.id] = pos
  return px
}

// Execute a plan through compliance, returning a new book (immutable-ish).
export function execute(book, orders, ctx = {}) {
  const next = { ...book, positions: { ...book.positions }, marks: { ...book.marks }, blotter: [...book.blotter] }
  next.positions = Object.fromEntries(Object.entries(next.positions).map(([k, v]) => [k, { ...v }]))
  let filled = 0
  let vetoed = 0
  for (const order of orders) {
    const check = preTrade(order, next, ctx)
    const stamp = { seq: ++next.seq, ...order, qty: +order.qty.toFixed(2) }
    if (check.ok) {
      const px = fill(next, order)
      next.blotter.unshift({ ...stamp, status: 'FILLED', fillPx: +px.toFixed(2) })
      filled += 1
    } else {
      next.blotter.unshift({ ...stamp, status: 'VETOED', reason: check.reason })
      vetoed += 1
    }
  }
  next.blotter = next.blotter.slice(0, 40)
  return { book: next, filled, vetoed }
}

// Mark-to-market and append a daily reconciliation snapshot.
export function reconcile(book, markReturns, label) {
  const next = { ...book, marks: { ...book.marks }, history: [...book.history] }
  next.cash *= 1 + CASH_RATE / 100 / 12 // cash earns the bill rate
  for (const a of UNIVERSE) next.marks[a.id] = A[a.id] ? book.marks[a.id] * (1 + (markReturns[a.id] ?? 0) / 100) : book.marks[a.id]
  const nav = book.cash * (1 + CASH_RATE / 100 / 12) + UNIVERSE.reduce((s, a) => s + (next.positions[a.id]?.qty ?? 0) * next.marks[a.id], 0)
  const gross = UNIVERSE.reduce((s, a) => s + Math.abs((next.positions[a.id]?.qty ?? 0) * next.marks[a.id]), 0)
  const unreal = UNIVERSE.reduce((s, a) => {
    const p = next.positions[a.id]
    return p ? s + (next.marks[a.id] - p.avgCost) * p.qty : s
  }, 0)
  next.history = [...next.history, {
    label: label ?? `t${next.history.length + 1}`,
    nav: +nav.toFixed(0),
    cash: +next.cash.toFixed(0),
    gross: +(gross / nav).toFixed(3),
    realized: +next.realized.toFixed(0),
    unrealized: +unreal.toFixed(0),
  }].slice(-60)
  return next
}

// The positions ledger for display: qty, avg cost, mark, notional, P&L, weight.
export function positionsLedger(book) {
  const nav = bookNav(book)
  return UNIVERSE.filter((a) => book.positions[a.id]?.qty).map((a) => {
    const p = book.positions[a.id]
    const mv = p.qty * book.marks[a.id]
    return {
      id: a.id,
      name: a.name,
      cls: a.cls,
      qty: Math.round(p.qty),
      avgCost: +p.avgCost.toFixed(2),
      mark: +book.marks[a.id].toFixed(2),
      mv: Math.round(mv),
      upnl: Math.round((book.marks[a.id] - p.avgCost) * p.qty),
      weight: +(mv / nav).toFixed(3),
    }
  })
}

// Serialization for the localStorage audit trail.
export const serializeBook = (book) => JSON.stringify(book)
export function deserializeBook(text) {
  try {
    const b = JSON.parse(text)
    if (b && b.marks && b.positions && Array.isArray(b.blotter)) return b
  } catch {
    /* corrupt — start fresh */
  }
  return initBook()
}
