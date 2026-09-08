import { PROXIES } from '../../src/engine/proxies.js'

// ————— Alpaca PAPER broker: next-open execution —————
// The paper book fills at the same close it used to decide (see
// docs/RISK_POLICY.md §5). No real account can do that: once the closing
// print exists, the chance to trade at it is gone. This module is the honest
// version — the run's target weights are submitted as MARKET-ON-OPEN orders
// and fill at the NEXT session's opening auction, a price nobody knows at
// decision time.
//
// It therefore does NOT reproduce the paper book's numbers, and is not meant
// to. The gap IS the measurement: what the same-close shortcut is worth, in
// dollars, on a real venue. Same idea as the control arm measuring the ruin
// ceiling instead of assuming it.
//
// ————— WHICH BOOK THIS MIRRORS: the CONTROL ARM, not the canonical book ——
// Both books target the SAME weights (`decision.coreTargetWeights`); they
// differ only in whether compliance halts buys under the 2.5% ruin ceiling.
// This module never applies that gate, so it has always been a control-arm
// mirror by construction — but nothing said so, and nothing enforced it.
// Now it is stated, sealed (`mirrors`), and checked in verify.
//
// That is the CORRECT pairing, not a workaround. Comparing the broker to the
// canonical book would confound TWO differences at once — fill timing AND
// the ceiling — and the residual would attribute neither. Against the
// control arm exactly one thing differs: when the fill happens. The
// benchmark NAV is sealed alongside each submission (`benchmarkNav`) so a
// later analysis has both sides of the comparison in one row and never has
// to re-derive which arm it was paired against.
//
// It also happens to be the only pairing that produces data right now: with
// the ceiling breached the canonical book vetoes its buys, so a mirror of it
// would submit nothing and measure nothing.
//
// THE CHARTER. The host below is hard-coded to the paper endpoint. Live keys
// against it simply fail to authenticate, so no configuration mistake can
// route this at real money. It is gated on its own key pair
// (ALPACA_PAPER_KEY_ID / ALPACA_PAPER_SECRET_KEY), deliberately distinct from
// the ALPACA_KEY_ID market-data pair — having market data working must never
// imply order submission is on.
const PAPER_HOST = 'https://paper-api.alpaca.markets'

export const brokerConfigured = () =>
  Boolean(process.env.ALPACA_PAPER_KEY_ID && process.env.ALPACA_PAPER_SECRET_KEY)

// Deterministic per (run, ticker). Alpaca rejects a duplicate
// client_order_id, so a re-run of the same seq cannot double-submit — the
// broker inherits the chain's own "records decisions, not invocations" rule
// from the venue itself rather than from our bookkeeping.
export const clientOrderId = (seq, ticker) => `apcap-${seq}-${ticker}`
export const seqOfClientOrderId = (id) => {
  const m = /^apcap-(\d+)-/.exec(id || '')
  return m ? Number(m[1]) : null
}

// ————— Pure transforms —————

// Size to slightly UNDER account equity. A buy is sized off last night's
// close but fills at the next OPEN: if the market gaps up, an order sized at
// 100% of equity exceeds buying power and the venue rejects it. Systematic
// rejection on every gap-up day is not information, it is a broken desk. The
// buffer costs a little tracking error against the paper book — small next to
// the gap effect being measured — and is sealed in each record so the
// analysis can account for it rather than discover it.
export const CASH_BUFFER = 0.005 // 50bp

// The Charter's Core gross ceiling is 1.0×. This is the last point before
// orders reach a real venue, so it fails LOUD rather than silently sizing
// into margin — an overshoot here means something upstream broke the ceiling,
// and quietly borrowing to honor it is the worst available response.
export function assertGross(weights) {
  const gross = Object.values(weights || {}).reduce((s, w) => s + Math.max(0, w || 0), 0)
  if (gross > 1.0000001) throw new Error(`target gross ${gross.toFixed(6)} exceeds the 1.0x Core ceiling — refusing to submit`)
  return gross
}

// Target whole-share counts per ticker from the run's traded weights.
// WHOLE shares because market-on-open does not accept fractional or notional
// orders; the rounding residual lands in cash, which is the honest cost of
// trading a real venue rather than a par-normalized simulation.
export function targetShares(weights, equity, prices) {
  assertGross(weights)
  const investable = equity * (1 - CASH_BUFFER)
  const out = {}
  for (const [sleeve, w] of Object.entries(weights || {})) {
    const proxy = PROXIES[sleeve]
    if (!proxy || sleeve === 'cash') continue // cash is the residual, never an order
    const px = prices?.[proxy.ticker]?.close
    if (!Number.isFinite(px) || px <= 0) continue // no price ⇒ no order, never a guess
    if (!Number.isFinite(w) || w <= 0) {
      out[proxy.ticker] = 0
      continue
    }
    out[proxy.ticker] = Math.floor((w * investable) / px)
  }
  return out
}

// Diff target vs held into orders. Sells first, for the same reason the OMS
// sequences them first: free capacity before deploying it.
//
// Only tickers PRESENT in `targets` are acted on. Absent ≠ zero: a sleeve
// genuinely weighted to nothing gets an explicit `0` from targetShares above,
// while a ticker whose close failed to arrive is simply omitted. Treating
// omission as a zero target would liquidate a real position on a data outage
// — the feed going quiet is not an instruction to sell.
export function planBrokerOrders(targets, held) {
  const orders = []
  for (const ticker of Object.keys(targets || {})) {
    const want = targets[ticker]
    const have = held?.[ticker] ?? 0
    const dq = want - have
    if (dq === 0) continue
    orders.push({ ticker, side: dq > 0 ? 'buy' : 'sell', qty: Math.abs(dq) })
  }
  const rank = (o) => (o.side === 'sell' ? 0 : 1)
  return orders.sort((a, b) => rank(a) - rank(b) || b.qty - a.qty)
}

// ————— Alpaca REST —————

async function alpaca(path, init = {}) {
  let res
  try {
    res = await fetch(`${PAPER_HOST}${path}`, {
      ...init,
      headers: {
        'APCA-API-KEY-ID': process.env.ALPACA_PAPER_KEY_ID,
        'APCA-API-SECRET-KEY': process.env.ALPACA_PAPER_SECRET_KEY,
        'content-type': 'application/json',
        accept: 'application/json',
        ...(init.headers || {}),
      },
      signal: AbortSignal.timeout(15_000),
    })
  } catch (err) {
    // "fetch failed" says nothing — surface err.cause (see CLAUDE.md).
    const cause = err?.cause ? `: ${err.cause.code || err.cause.message || err.cause}` : ''
    const kind = err?.name === 'TimeoutError' || err?.name === 'AbortError' ? 'timed out (15s)' : 'fetch failed'
    throw new Error(`Alpaca paper ${path} ${kind}${cause}`)
  }
  return res
}

export async function getAccount() {
  const res = await alpaca('/v2/account')
  if (!res.ok) throw new Error(`Alpaca account HTTP ${res.status}`)
  return res.json()
}

// Held whole shares by ticker.
export async function getPositions() {
  const res = await alpaca('/v2/positions')
  if (!res.ok) throw new Error(`Alpaca positions HTTP ${res.status}`)
  const rows = await res.json()
  return Object.fromEntries((rows || []).map((p) => [p.symbol, Math.trunc(Number(p.qty))]))
}

// Orders this system submitted, newest first. Used to reconcile the PREVIOUS
// run's submissions: an order sent after Friday's close does not fill until
// Monday's open, so its fill price is only knowable on a later run. That lag
// is real T+1 reconciliation, not a shortcoming.
export async function getOurOrders(limit = 100) {
  const res = await alpaca(`/v2/orders?status=all&limit=${limit}&direction=desc`)
  if (!res.ok) throw new Error(`Alpaca orders HTTP ${res.status}`)
  const rows = await res.json()
  return (rows || []).filter((o) => seqOfClientOrderId(o.client_order_id) !== null)
}

// Market-on-open. Alpaca accepts time_in_force `opg` for the next opening
// auction; the cron submits after the close, so these queue overnight.
// NOTE: the exact accepted submission window is Alpaca's to enforce — a
// rejection surfaces per-order rather than failing the run, because a
// venue refusing an order is information, not a crash.
export async function submitNextOpen(orders, seq) {
  const submitted = []
  const rejected = []
  for (const o of orders) {
    try {
      const res = await alpaca('/v2/orders', {
        method: 'POST',
        body: JSON.stringify({
          symbol: o.ticker,
          qty: String(o.qty),
          side: o.side,
          type: 'market',
          time_in_force: 'opg', // market-on-open: fills at the NEXT open
          client_order_id: clientOrderId(seq, o.ticker),
        }),
      })
      if (res.status === 422) {
        // 422 covers both a duplicate client_order_id (a safe re-run) and a
        // genuinely invalid order. Both are non-fatal; record the reason.
        const body = await res.json().catch(() => ({}))
        rejected.push({ ...o, reason: body?.message || 'rejected (422)' })
        continue
      }
      if (!res.ok) {
        rejected.push({ ...o, reason: `HTTP ${res.status}` })
        continue
      }
      const j = await res.json()
      submitted.push({ ...o, id: j.id, clientOrderId: j.client_order_id, status: j.status })
    } catch (err) {
      rejected.push({ ...o, reason: String(err.message || err) })
    }
  }
  return { submitted, rejected }
}

// One broker step for a sealed run: reconcile what previously filled, then
// queue this run's orders for the next open.
//
// Ordering is deliberate: everything that can THROW (account, prior orders,
// positions) happens strictly BEFORE the first submission, and the submit
// loop catches per order. So a thrown step means nothing was sent — there is
// no state where orders reached the venue but the caller saw an exception and
// has no record of them. The venue is also the idempotency authority (the
// deterministic client_order_id), not our database, so a failure to record
// afterwards still cannot cause a double-submit.
export const MIRRORS = 'control-arm (ruin ceiling off)'

export async function stepBroker({ seq, weights, prices, benchmarkNav = null }) {
  if (!brokerConfigured()) return { configured: false }

  const account = await getAccount()
  const equity = Number(account.equity)
  if (!Number.isFinite(equity) || equity <= 0) throw new Error(`implausible account equity (${account.equity})`)

  // Reconcile: fills from earlier submissions, learned now.
  const prior = await getOurOrders()
  const fills = prior
    .filter((o) => o.filled_at && Number(o.filled_qty) > 0)
    .map((o) => ({
      seq: seqOfClientOrderId(o.client_order_id),
      ticker: o.symbol,
      side: o.side,
      qty: Number(o.filled_qty),
      avgPrice: Number(o.filled_avg_price),
      filledAt: o.filled_at,
    }))

  const held = await getPositions()
  // Sized off the LAST CLOSE but filled at the NEXT OPEN — so the realized
  // weights will miss their targets by the overnight gap. That miss is not an
  // error to engineer away; it is the honest cost of not knowing tomorrow's
  // opening print, and it is precisely what this book exists to measure.
  const targets = targetShares(weights, equity, prices)
  const orders = planBrokerOrders(targets, held)
  const { submitted, rejected } = await submitNextOpen(orders, seq)

  return {
    configured: true,
    equity: +equity.toFixed(2),
    fillTiming: 'next-open (market-on-open)',
    // Which paper book this row is the venue-side counterpart of, and that
    // book's NAV at the same moment. Sealed together so the comparison can
    // never be reconstructed against the wrong arm later.
    mirrors: MIRRORS,
    benchmarkNav,
    cashBufferPct: +(CASH_BUFFER * 100).toFixed(2), // held back so a gap-up open can't reject every buy
    // Scale check. The comparison is only readable in dollars when the two
    // sides are the same size; below ~0.9 or above ~1.1 read percentages
    // instead, and fund the paper account to match (docs/BACKEND.md).
    scaleRatio: Number.isFinite(benchmarkNav) && benchmarkNav > 0 ? +(equity / benchmarkNav).toFixed(3) : null,
    heldBefore: held,
    submitted: submitted.map((o) => ({ ticker: o.ticker, side: o.side, qty: o.qty, clientOrderId: o.clientOrderId })),
    rejected,
    // Fills reported here belong to EARLIER runs — an order queued after the
    // close cannot fill until the next open. This is a rolling snapshot of
    // the venue's recent fills, not a delta: the same fill legitimately
    // appears on consecutive rows, because each row states what was true at
    // its own moment. The venue's order history is the ledger; this is the
    // observation of it.
    recentFills: fills.slice(0, 20),
  }
}
