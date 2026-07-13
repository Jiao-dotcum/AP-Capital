import { mulberry32, normal } from './prng.js'
import { drawReading } from './machine.js'
import { CYCLE0, evolveCycle } from './cycle.js'
import { UNIVERSE, monthlyReturn, stressAmp } from './assets.js'

// ————— The shared macro path —————
// One seeded walk of the simulated world — reading, cycle, and the month's
// asset returns — consumed by every standalone backtest (mandateBacktest,
// pureAlpha) so their series are measured over the IDENTICAL history and the
// rng draw order exists in exactly one place. The legacy backtest.js keeps
// its own verbatim copy on purpose: it is the frozen court record that
// justified the decoupling, and its draw order must never move (Invariant 3).
//
// Draw order per month, fixed forever: drawReading → evolveCycle → one
// shared market shock → per-asset idiosyncratic draws in UNIVERSE order.
export function walkMacroPath(seed, months, step) {
  const rng = mulberry32(seed)
  let reading = null
  let cycle = CYCLE0
  for (let t = 0; t < months; t++) {
    reading = drawReading(rng, reading)
    cycle = evolveCycle(rng, cycle, reading)
    const common = normal(rng) * stressAmp(reading)
    const rets = Object.fromEntries(UNIVERSE.map((a) => [a.id, monthlyReturn(a, reading, rng, normal, common)]))
    step({ t, reading, cycle, rets })
  }
}
