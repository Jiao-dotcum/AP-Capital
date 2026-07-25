import { screenPerforming, secondLevelThesis } from '../../src/engine/credit.js'
import { creditWeightsFor, triggersFrom, deployAuthorized, postureOf } from '../../src/engine/cycle.js'
import { TRADE_COST_BP } from '../../src/engine/creditBacktest.js'
import { CASH_RATE } from '../../src/engine/assets.js'

// ————— The Cycle Credit mandate's paper book (live, server-side) —————
// AP Cycle Credit finally holds positions instead of just publishing a
// screen. One $1M paper book, stepped once per canonical run:
//
//   PERFORMING sleeve — the real screenPerforming book on that day's live
//     cycle state: carry (rf + each name's screened market spread) plus
//     price mark-to-market off the screen's own price series, minus a 25bp
//     one-way trading cost on turnover (same constant as the backtest —
//     one formula, one module).
//   DISTRESSED sleeve — the CLO BB proxy (1.55× HY OAS, spread duration
//     4.5y) when ≥ 2 dry-powder triggers arm; earns cash while idle.
//   DRY POWDER — cash at the bill rate.
//
// Sleeve weights are creditWeightsFor(dial) — the dial's one jurisdiction.
// Unlike the backtest walk, the LIVE book simulates no issuer migrations or
// defaults: the ten simulated names are a static structural snapshot, and
// marks move only with the real, FRED-anchored cycle state. Since 2026-07-13
// the traded universe (`issuers`, below) additionally includes real,
// live-verified names when api/_lib/realIssuers.js clears them — see
// engine/credit.js's tradedIssuers. Every figure is simulated/paper, labeled
// as such, and sealed into the run's hash chain via the `credit` block.

export const CREDIT_START_NAV = 1_000_000
const DISTRESSED_MULT = 1.55
const DISTRESSED_SPREAD_DURATION = 4.5

export function initCreditBook() {
  return {
    nav: CREDIT_START_NAV,
    prevRows: null, // last screen: [{id, name, weight, price, marketSpread, verdict}]
    prevCLOSpread: null,
    seq: 0,
  }
}

const slim = (rows) =>
  rows.map((r) => ({ id: r.id, name: r.name, weight: +r.weight.toFixed(2), price: r.price, marketSpread: r.marketSpread, verdict: r.verdict }))

// Advance the credit book one canonical run. Pure: same inputs ⇒ same book.
// Returns { book, pnl, orders } — pnl and orders are sealed in the payload.
// `issuers` is the desk's actual traded universe for this run (tradedIssuers
// applied by the caller); omitted, screenPerforming falls back to its own
// simulated-only default — existing callers/tests are unaffected.
export function stepCreditBook(prev, { cycle, dial, dialOverride, issuers }) {
  const book = prev ?? initCreditBook()
  const rows = screenPerforming(cycle, issuers)
  const [perfW, distW, powderW] = creditWeightsFor(dial)
  const triggers = triggersFrom(cycle)
  const deploy = deployAuthorized(triggers)
  const cloSpread = DISTRESSED_MULT * cycle.hySpread
  const cashMo = CASH_RATE / 12 // %/month

  // ————— Day P&L off the book held INTO this run —————
  let perfRet = 0 // % on the performing sleeve
  let turnover = 0 // one-way, fraction of sleeve
  if (book.prevRows) {
    for (const prevRow of book.prevRows) {
      if (prevRow.weight <= 0) continue
      const now = rows.find((r) => r.id === prevRow.id)
      // A name can leave the traded universe entirely — not just fail this
      // cycle's screen (screenPerforming still returns a REJECT row, weight
      // 0, for every issuer it was GIVEN), but actually vanish from
      // `issuers` itself. That's only possible for real issuers (a data
      // source stops returning the name); the ten simulated names are a
      // fixed universe and never do this. No fresh price exists to mark
      // against, so skip today's contribution rather than crash on it —
      // the "sell to zero" order below already exits the position.
      if (!now) continue
      const carry = (380 + prevRow.marketSpread) / 1200 // rf + spread accrual, %/mo
      const mtm = 100 * (now.price / prevRow.price - 1)
      perfRet += (prevRow.weight / 100) * (carry + mtm)
    }
    // Screen weights do NOT always sum to 100: when few names clear the
    // gates, the single-name cap leaves capital with nowhere compliant to
    // go. That was unreachable with the fixed ten simulated issuers (five
    // always cleared, summing to 100) and became reachable the moment the
    // desk traded a real universe, where a strict screen can leave most of
    // the sleeve uninvested. Uninvested sleeve capital is CASH and earns the
    // bill rate — before this it silently earned zero, understating the
    // sleeve's return by the idle share.
    const investedW = book.prevRows.reduce((s, p) => s + Math.max(0, p.weight), 0)
    perfRet += (Math.max(0, 100 - investedW) / 100) * cashMo
    for (const r of rows) {
      const before = book.prevRows.find((p) => p.id === r.id)?.weight ?? 0
      if (r.weight > before) turnover += (r.weight - before) / 100
    }
  } else {
    turnover = rows.reduce((s, r) => s + r.weight / 100, 0) // initial build
  }
  const tradingCost = turnover * (TRADE_COST_BP / 100)
  perfRet -= tradingCost

  const distRet =
    deploy && book.prevCLOSpread != null
      ? cloSpread / 1200 - DISTRESSED_SPREAD_DURATION * ((cloSpread - book.prevCLOSpread) / 100)
      : cashMo
  const dayRetPct = (perfW / 100) * perfRet + (distW / 100) * distRet + (powderW / 100) * cashMo

  const navStart = book.nav
  const navEnd = +(navStart * (1 + dayRetPct / 100)).toFixed(2)

  // ————— Orders: weight shifts ≥ 0.5pp, each with its reason —————
  const posture = postureOf(dial)
  const dialWord = dialOverride != null ? `dial ${dial} (${posture.word}, human-ratified)` : `dial ${dial} (${posture.word}, automatic)`
  const orders = []
  const prevOf = (id) => book.prevRows?.find((p) => p.id === id)?.weight ?? 0
  for (const r of rows) {
    const before = prevOf(r.id)
    const dw = r.weight - before
    if (Math.abs(dw) < 0.5) continue
    orders.push({
      side: dw > 0 ? 'BUY' : 'SELL',
      id: r.id,
      name: r.name,
      fromW: +before.toFixed(1),
      toW: +r.weight.toFixed(1),
      sleeve: 'performing',
      rationale:
        `${dw > 0 ? 'BUY' : 'SELL'} to move ${r.name} from ${before.toFixed(1)}% to ${r.weight.toFixed(1)}% of the performing sleeve: ` +
        `AP Cycle Credit — margin-of-safety sizing under ${dialWord}, verdict ${r.verdict}. ${secondLevelThesis(r)}`,
    })
  }
  // Names that fell out of the screen entirely.
  for (const prevRow of book.prevRows ?? []) {
    if (prevRow.weight > 0.5 && !rows.find((r) => r.id === prevRow.id && r.weight > 0)) {
      const now = rows.find((r) => r.id === prevRow.id)
      orders.push({
        side: 'SELL',
        id: prevRow.id,
        name: prevRow.name,
        fromW: +prevRow.weight.toFixed(1),
        toW: 0,
        sleeve: 'performing',
        rationale: `SELL ${prevRow.name} to zero: dropped by the screen — ${now?.reason || 'no longer clears the gates'}.`,
      })
    }
  }

  const pnl = {
    navStart,
    navEnd,
    dayPnl: +(navEnd - navStart).toFixed(2),
    dayRetPct: +dayRetPct.toFixed(3),
    tradingCost: +(-(tradingCost * (perfW / 100)) * (navStart / 100)).toFixed(2), // dollars, sleeve-weighted
    sleeves: {
      performing: { weightPct: perfW, retPct: +perfRet.toFixed(3) },
      distressed: { weightPct: distW, retPct: +distRet.toFixed(3), deployed: deploy },
      powder: { weightPct: powderW, retPct: +cashMo.toFixed(3) },
    },
  }

  return {
    book: { nav: navEnd, prevRows: slim(rows), prevCLOSpread: cloSpread, seq: book.seq + 1 },
    pnl,
    orders,
  }
}
