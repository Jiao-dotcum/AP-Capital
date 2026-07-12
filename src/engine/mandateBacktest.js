import { mulberry32, normal } from './prng.js'
import { drawReading } from './machine.js'
import {
  CYCLE0,
  evolveCycle,
  proxyScores,
  dialFrom,
  settleDial,
  creditWeightsFor,
  triggersFrom,
  deployAuthorized,
} from './cycle.js'
import { UNIVERSE, monthlyReturn, stressAmp } from './assets.js'
import { buildRiskReport } from './risk.js'
import { BACKTEST_SEED, BACKTEST_MONTHS } from './backtest.js'
import { DEFAULT_ELECTED } from './world.js'
import { createCreditWalker } from './creditBacktest.js'

// ————— Standalone mandate backtests —————
// Two products, two real engines, walked over the SAME 22-year seeded path
// in one loop so the comparison is apples-to-apples. This module owns its
// own mulberry32(seed) for the macro/cycle path, and the credit walker owns
// one stream PER ISSUER — none of them touch the draw sequence
// risk.js/backtest.js already share (Invariant 3).
//
// AP All Weather Core: the ACTUAL production engine. buildRiskReport's fixed
// risk-parity weights (no dial input — the decoupling) applied to the
// UNIVERSE's monthly factor returns. Nothing approximated.
//
// AP Cycle Credit: the full-rigor walk (creditBacktest.js) — issuer
// fundamentals evolve monthly on their own seeded streams, ratings actually
// migrate and default through the credit.js transition matrix, and the
// performing book is a real ledger: carry + price mark-to-market + realized
// default losses − turnover costs, screened by the SAME screenPerforming
// the live desk runs. The distressed sleeve prices off the same CLO BB Debt
// proxy formula proxyVehicles() quotes (1.55× HY OAS; floating-rate, so
// near-zero rate duration but ~4.5y SPREAD duration), gated by the same
// deployAuthorized triggers, cash otherwise. creditWeightsFor(dial) blends
// the three sleeves, lagged one period (the dial only updates at loop-end,
// so the top-of-loop value is last period's settled call — no lookahead).
//
// Remaining honesty gap (docs/CREDIT_BACKTEST_SCOPE.md §4): the issuer paths
// are calibrated, not yet validated against real historical spread/default
// data by rating bucket. A model of a model, labeled as such.

const DISTRESSED_MULT = 1.55 // CLO BB Debt spread vs HY OAS (matches credit.js proxyVehicles)
const DISTRESSED_SPREAD_DURATION = 4.5 // yrs — floating-rate tranche: rate duration ≈ 0, spread duration ~4–5

export function runMandateBacktests(seed = BACKTEST_SEED, months = BACKTEST_MONTHS) {
  const elected = UNIVERSE.filter((a) => DEFAULT_ELECTED.includes(a.id))
  const rr = buildRiskReport(elected)
  const coreW = rr.rp.weights
  const coreCashW = rr.rp.cashW

  const rng = mulberry32(seed)
  const walker = createCreditWalker(seed)
  let reading = null
  let cycle = CYCLE0
  let hist = []
  let dial = dialFrom(proxyScores(CYCLE0))
  let prevCLOSpread = DISTRESSED_MULT * CYCLE0.hySpread

  const core = []
  const credit = []

  for (let t = 0; t < months; t++) {
    reading = drawReading(rng, reading)
    cycle = evolveCycle(rng, cycle, reading)
    const common = normal(rng) * stressAmp(reading)
    const rets = Object.fromEntries(UNIVERSE.map((a) => [a.id, monthlyReturn(a, reading, rng, normal, common)]))

    // ————— Core: fixed weights, the real production engine —————
    let coreR = coreCashW * rets.cash
    for (const [id, w] of Object.entries(coreW)) coreR += w * rets[id]
    core.push(coreR)

    // ————— Credit: the full-rigor ledger walk —————
    const perfRet = walker.step(cycle)

    const deploy = deployAuthorized(triggersFrom(cycle))
    const cloSpread = DISTRESSED_MULT * cycle.hySpread
    const distRet = deploy
      ? cloSpread / 1200 - DISTRESSED_SPREAD_DURATION * ((cloSpread - prevCLOSpread) / 100)
      : rets.cash
    prevCLOSpread = cloSpread // marks track even while idle, so first deployment isn't a discontinuity

    const [perfW, distW, powderW] = creditWeightsFor(dial) // last period's settled dial — no lookahead
    credit.push((perfW / 100) * perfRet + (distW / 100) * distRet + (powderW / 100) * rets.cash)

    hist = [...hist, cycle].slice(-260)
    dial = settleDial(dial, dialFrom(proxyScores(cycle, hist)))
  }

  return { core, credit, creditDiag: walker.diag }
}
