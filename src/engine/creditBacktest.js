import { mulberry32, normal, clamp } from './prng.js'
import { CYCLE0 } from './cycle.js'
import { ISSUERS, TRANSITION, RATING_BUCKETS, bucketOf, mertonDtD, screenPerforming } from './credit.js'

// ————— The full-rigor credit walk (see docs/CREDIT_BACKTEST_SCOPE.md) —————
// Everything the v1 estimate lacked, implemented:
//   1. TIME-VARYING FUNDAMENTALS — each issuer's lev/cov/mult follow monthly
//      mean-reverting, cycle-linked paths drawn from that issuer's OWN seeded
//      mulberry32 stream (Invariant 3: new randomness gets its own generator;
//      the macro/cycle draw order is never touched).
//   2. REALIZED MIGRATION & DEFAULT — the one-year TRANSITION matrix from
//      credit.js, monthly-ized, actually rolled each month per issuer.
//      Default intensity is modulated by cycle stress (defaults cluster when
//      spreads are wide) and by the issuer's CURRENT Merton distance-to-
//      default — so the screen's dd/coverage gates get a fair, adversarial
//      test: if the gates measure anything, the names they reject should
//      default more often than the names they hold.
//   3. A POSITION LEDGER — the performing book holds last screen's weights
//      into each month: survivors earn carry (rf + spread accrual) plus
//      price mark-to-market off the screen's own price field; a default
//      realizes (recovery − price)/price on the held weight that month; and
//      one-way turnover to the new screen's weights pays a trading cost.
//
// Calibration assumptions (owner-approved, stylized, documented):
//   - HY cash trading cost ~50bp round trip → 25bp one-way on turnover.
//   - Default intensity multipliers: stress (0.6 + 1.8·s, s = spread
//     percentile 0..1) and structure exp(1.1·(2.2 − DtD)) clamped to
//     [0.35, 3.5] — through-the-cycle they average near the agency matrix.
//   - A defaulted issuer REORGANIZES next month: fundamentals and rating
//     reset to its snapshot. The universe stays ten names; survivorship is
//     handled by realizing the loss, not by deleting the row.
//
// Still open (scope doc §4): validating these synthetic paths against real
// historical spread/default data by rating bucket once the FRED feed is
// confirmed live. Until then this is a model of a model — labeled as such.

export const TRADE_COST_BP = 25 // one-way, on performing-book turnover
const REVERT = 0.05 // monthly mean-reversion toward the issuer's snapshot
const S0 = (CYCLE0.hySpread - 220) / 1030 // the calm anchor on the 0..1 stress scale

// Monthly-ized transition matrix: p_m = 1 − (1 − p_year)^(1/12) off-diagonal,
// diagonal takes the remainder. A standard quick approximation of the matrix
// 12th-root — fine at these magnitudes.
const MONTHLY = Object.fromEntries(
  Object.entries(TRANSITION).map(([from, row]) => {
    const m = row.map((p, k) => (RATING_BUCKETS[k] === from ? 0 : 1 - (1 - p) ** (1 / 12)))
    const off = m.reduce((s, p) => s + p, 0)
    return [from, m.map((p, k) => (RATING_BUCKETS[k] === from ? 1 - off : p))]
  }),
)

const DEFAULT_COL = RATING_BUCKETS.indexOf('Default')

// One issuer's mutable state. `rating` feeds the screen's market-quote
// anchor: the snapshot's fine rating until the first migration, the coarse
// bucket after (credit.js falls back to the bucket quote for coarse names).
// `av` rides along because mertonDtD reads mult/lev/av off this object when
// the default-intensity modulation recomputes distance-to-default.
function seedIssuerState(base) {
  return { base, lev: base.lev, cov: base.cov, mult: base.mult, av: base.av, bucket: bucketOf(base.rating), rating: base.rating }
}

// Create the walker: one closure holding per-issuer rng streams and the
// ledger, stepped once per month by the mandate backtest. Deterministic:
// same seed ⇒ same fundamentals paths, same migrations, same defaults.
export function createCreditWalker(seed) {
  const streams = ISSUERS.map((_, k) => mulberry32((seed ^ 0x9e3779b9) + k * 7919))
  const states = ISSUERS.map(seedIssuerState)

  let prevRows = null // last month's screen (weights, prices, spreads)
  const diag = {
    defaults: 0,
    heldDefaults: 0,
    rejectedDefaults: 0,
    heldMonths: 0,
    rejectedMonths: 0,
    migrations: 0,
  }

  // Advance one month against this month's cycle state; returns the
  // performing sleeve's % return for the month.
  function step(cycle) {
    const s = clamp((cycle.hySpread - 220) / 1030, 0, 1)
    const lenient = (cycle.lenderEase - 50) / 50 // +1 easy money … −1 rationing

    // 1. Evolve fundamentals + roll migration, fixed draw order per issuer:
    //    three normals (lev, cov, mult) then one uniform (migration).
    const defaultedNow = new Set()
    for (let k = 0; k < states.length; k++) {
      const st = states[k]
      const rng = streams[k]
      const n1 = normal(rng)
      const n2 = normal(rng)
      const n3 = normal(rng)
      const u = rng()

      // Leverage creeps up when lenders chase deals, unwinds under stress.
      st.lev = clamp(st.lev + REVERT * (st.base.lev - st.lev) + 0.030 * lenient + 0.05 * n1, 1.5, 9.5)
      // Coverage erodes as stress rises above the calm anchor.
      st.cov = clamp(st.cov + REVERT * (st.base.cov - st.cov) - 0.35 * (s - S0) * (st.base.cov / 12) + 0.02 * st.base.cov * n2, 0.8, 6.5)
      // EV multiples compress toward a stress-discounted target.
      const multTarget = st.base.mult * (1 - 0.25 * (s - S0))
      st.mult = clamp(st.mult + 0.08 * (multTarget - st.mult) + 0.015 * st.base.mult * n3, 5, 14)

      // Migration: bucket matrix, default column modulated by stress and by
      // the issuer's CURRENT structural distance-to-default.
      const row = MONTHLY[st.bucket]
      const dd = mertonDtD(st, 1)
      const intensity = clamp(Math.exp(1.1 * (2.2 - dd)), 0.35, 3.5) * (0.6 + 1.8 * s)
      const pDef = clamp(row[DEFAULT_COL] * intensity, 0, 0.5)
      // Renormalize the stay-put mass so the row still sums to 1.
      const pOther = row.reduce((sum, p, c) => (c === DEFAULT_COL || RATING_BUCKETS[c] === st.bucket ? sum : sum + p), 0)
      const pStay = 1 - pDef - pOther
      let acc = 0
      let landed = st.bucket
      for (let c = 0; c < RATING_BUCKETS.length; c++) {
        const col = RATING_BUCKETS[c]
        acc += col === 'Default' ? pDef : col === st.bucket ? pStay : row[c]
        if (u < acc) {
          landed = col
          break
        }
      }
      if (landed === 'Default') {
        defaultedNow.add(st.base.id)
        diag.defaults += 1
        // Reorganize: emerge next month with the snapshot balance sheet.
        states[k] = seedIssuerState(st.base)
      } else if (landed !== st.bucket) {
        diag.migrations += 1
        st.bucket = landed
        st.rating = landed // coarse bucket → credit.js bucket-level quote
      }
    }

    // 2. Screen the EVOLVED issuers through the real desk engine.
    const evolved = states.map((st) => ({ ...st.base, lev: st.lev, cov: st.cov, mult: st.mult, rating: st.rating }))
    const rows = screenPerforming(cycle, evolved)

    // 3. Ledger: last month's book carried into this month's marks.
    let ret = 0
    if (prevRows) {
      for (const prev of prevRows) {
        const held = prev.weight > 0
        const defaulted = defaultedNow.has(prev.id)
        if (defaulted) {
          if (held) diag.heldDefaults += 1
          else diag.rejectedDefaults += 1
        }
        if (held) diag.heldMonths += 1
        else diag.rejectedMonths += 1
        if (!held) continue
        const w = prev.weight / 100
        if (defaulted) {
          ret += w * 100 * (prev.recovery / prev.price - 1) // realize the loss
        } else {
          const now = rows.find((r) => r.id === prev.id)
          const carry = (380 + prev.marketSpread) / 1200 // rf + spread accrual, %/mo
          const mtm = 100 * (now.price / prev.price - 1)
          ret += w * (carry + mtm)
        }
      }
      // One-way turnover into the new book pays the trading cost.
      let oneWay = 0
      for (const r of rows) {
        const prev = prevRows.find((p) => p.id === r.id)
        const before = defaultedNow.has(r.id) ? 0 : (prev?.weight ?? 0)
        if (r.weight > before) oneWay += (r.weight - before) / 100
      }
      ret -= oneWay * (TRADE_COST_BP / 100)
    } else {
      ret -= (TRADE_COST_BP / 100) * rows.reduce((sum, r) => sum + r.weight / 100, 0) // initial build
    }
    prevRows = rows
    return ret
  }

  return { step, diag }
}
