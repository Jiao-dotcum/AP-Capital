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
import { screenPerforming } from './credit.js'
import { buildRiskReport } from './risk.js'
import { BACKTEST_SEED, BACKTEST_MONTHS } from './backtest.js'
import { DEFAULT_ELECTED } from './world.js'

// ————— Standalone mandate backtests —————
// Two products, two real engines, walked over the SAME 22-year seeded path
// in one loop so the comparison is apples-to-apples. This module owns its
// own mulberry32(seed) instance — it does not touch the draw sequence
// risk.js/backtest.js already share (Invariant 3).
//
// AP All Weather Core: the ACTUAL production engine. buildRiskReport's fixed
// risk-parity weights (no dial input — the decoupling) applied to the
// UNIVERSE's monthly factor returns. Nothing approximated.
//
// AP Cycle Credit: the ACTUAL screening engine, walked. screenPerforming(cycle)
// runs fresh every month (deterministic per print, no rng of its own),
// producing the real margin-of-safety-weighted book; its return is carry
// minus duration-adjusted mark-to-market on the screened market spreads. The
// distressed sleeve prices off the same CLO BB Debt proxy proxyVehicles()
// already quotes (1.55x HY OAS) when >=2 triggers arm, cash otherwise — the
// same gate the live desk uses. creditWeightsFor(dial) blends the three
// sleeves, lagged one period (dial is only updated at loop-end, so the value
// read at top-of-loop is last period's settled call — no lookahead).
//
// THE HONEST LIMIT: issuer structural inputs (lev, cov, mult, av, recovery)
// are a fixed snapshot re-screened each print — they don't evolve, and no
// issuer actually migrates or defaults across the 22 years. This is a real
// engine walked, not a synthetic full issuer-history simulation. See
// docs/CREDIT_BACKTEST_SCOPE.md for what closing that gap requires.

const SPREAD_DURATION = 4 // years — HY/loan spread-duration assumption
const DISTRESSED_MULT = 1.55 // CLO BB Debt spread vs HY OAS (matches credit.js proxyVehicles)
const DISTRESSED_DURATION = 5.5 // years — a more convex tranche

export function runMandateBacktests(seed = BACKTEST_SEED, months = BACKTEST_MONTHS) {
  const elected = UNIVERSE.filter((a) => DEFAULT_ELECTED.includes(a.id))
  const rr = buildRiskReport(elected)
  const coreW = rr.rp.weights
  const coreCashW = rr.rp.cashW

  const rng = mulberry32(seed)
  let reading = null
  let cycle = CYCLE0
  let hist = []
  let dial = dialFrom(proxyScores(CYCLE0))
  let prevSpreads = {}
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

    // ————— Credit: the real screen, walked —————
    const screen = screenPerforming(cycle)
    const eligible = screen.filter((r) => r.weight > 0)
    let perfCarry = 0
    let perfMtm = 0
    const spreadsNow = {}
    for (const r of eligible) {
      const w = r.weight / 100
      perfCarry += w * (r.marketSpread / 1200) // bp/yr -> %/mo
      const prev = prevSpreads[r.id] ?? r.marketSpread
      perfMtm -= w * SPREAD_DURATION * ((r.marketSpread - prev) / 100)
      spreadsNow[r.id] = r.marketSpread
    }
    prevSpreads = spreadsNow
    const perfRet = perfCarry + perfMtm

    const deploy = deployAuthorized(triggersFrom(cycle))
    const cloSpread = DISTRESSED_MULT * cycle.hySpread
    const distRet = deploy
      ? cloSpread / 1200 - DISTRESSED_DURATION * ((cloSpread - prevCLOSpread) / 100)
      : rets.cash
    prevCLOSpread = cloSpread // marks track even while idle, so first deployment isn't a discontinuity

    const [perfW, distW, powderW] = creditWeightsFor(dial) // last period's settled dial — no lookahead
    credit.push((perfW / 100) * perfRet + (distW / 100) * distRet + (powderW / 100) * rets.cash)

    hist = [...hist, cycle].slice(-260)
    dial = settleDial(dial, dialFrom(proxyScores(cycle, hist)))
  }

  return { core, credit }
}
