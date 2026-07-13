import {
  proxyScores,
  dialFrom,
  settleDial,
  creditWeightsFor,
  triggersFrom,
  deployAuthorized,
  CYCLE0,
} from './cycle.js'
import { UNIVERSE } from './assets.js'
import { buildRiskReport } from './risk.js'
import { pureAlphaTilt, coreTargets } from './pureAlpha.js'
import { BACKTEST_SEED, BACKTEST_MONTHS } from './backtest.js'
import { DEFAULT_ELECTED } from './world.js'
import { walkMacroPath } from './macroPath.js'
import { createCreditWalker } from './creditBacktest.js'

// ————— Standalone mandate backtests —————
// Two products, two real engines, walked over the SAME 22-year seeded path
// (macroPath.js) so the comparison is apples-to-apples. The credit walker
// owns one rng stream PER ISSUER; nothing here touches the draw sequence
// risk.js/backtest.js share (Invariant 3).
//
// AP All Weather Core: the ACTUAL production book — risk parity at fixed
// 1.0× gross PLUS the Pure Alpha overlay, combined by the same
// coreTargets() the live OMS trades. The overlay cleared its pre-registered
// gate before being wired (avg Sharpe 0.163 standalone; blend beat rp-only
// 23/30 seeds, 0.313 → 0.358 avg, +0.41pp maxDD).
//
// AP Cycle Credit: the full-rigor walk (creditBacktest.js) — issuer
// fundamentals evolve monthly on their own seeded streams, ratings migrate
// and default through the monthly-ized TRANSITION matrix, and a position
// ledger realizes carry, price MTM, default losses, and turnover costs. The
// distressed sleeve prices off the same CLO BB proxy proxyVehicles() quotes
// (1.55× HY OAS; floating-rate, spread duration ~4.5y), gated by the same
// deployAuthorized triggers, cash otherwise. creditWeightsFor(dial) blends
// the sleeves, lagged one period — no lookahead. Remaining honesty gap:
// synthetic issuer paths, calibrated but not yet validated against real
// historical data (docs/CREDIT_BACKTEST_SCOPE.md §4).

const DISTRESSED_MULT = 1.55 // CLO BB Debt spread vs HY OAS (matches credit.js proxyVehicles)
const DISTRESSED_SPREAD_DURATION = 4.5 // yrs — floating tranche: rate duration ≈ 0, spread duration ~4–5

export function runMandateBacktests(seed = BACKTEST_SEED, months = BACKTEST_MONTHS) {
  const elected = UNIVERSE.filter((a) => DEFAULT_ELECTED.includes(a.id))
  const rp = buildRiskReport(elected).rp
  const walker = createCreditWalker(seed)

  let hist = []
  let dial = dialFrom(proxyScores(CYCLE0))
  let prevCLOSpread = DISTRESSED_MULT * CYCLE0.hySpread
  let pendingTilt = null // decided at T, earns at T+1 — same discipline as the dial

  const core = []
  const credit = []

  walkMacroPath(seed, months, ({ reading, cycle, rets }) => {
    // ————— Core: rp + Pure Alpha, the exact live formula —————
    const tgt = coreTargets(rp.weights, pendingTilt ? pendingTilt.tilt : {})
    let coreR = 0
    let tot = 0
    for (const [id, w] of Object.entries(tgt)) {
      coreR += w * rets[id]
      tot += w
    }
    coreR += Math.max(0, 1 - tot) * rets.cash
    core.push(coreR)

    // ————— Credit: the full-rigor ledger walk —————
    const perfRet = walker.step(cycle)
    const deploy = deployAuthorized(triggersFrom(cycle))
    const cloSpread = DISTRESSED_MULT * cycle.hySpread
    const distRet = deploy
      ? cloSpread / 1200 - DISTRESSED_SPREAD_DURATION * ((cloSpread - prevCLOSpread) / 100)
      : rets.cash
    prevCLOSpread = cloSpread // marks track even while idle
    const [perfW, distW, powderW] = creditWeightsFor(dial) // last period's settled dial
    credit.push((perfW / 100) * perfRet + (distW / 100) * distRet + (powderW / 100) * rets.cash)

    // Decide for next period with only what is knowable now.
    pendingTilt = pureAlphaTilt(reading.g, reading.i)
    hist = [...hist, cycle].slice(-260)
    dial = settleDial(dial, dialFrom(proxyScores(cycle, hist)))
  })

  return { core, credit, creditDiag: walker.diag }
}
