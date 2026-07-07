import { mulberry32, normal } from './prng.js'
import { drawReading, regimeOf, QUADRANTS } from './machine.js'
import { CYCLE0, evolveCycle, proxyScores, dialFrom, settleDial, weightsFor, DIAL_DEADBAND } from './cycle.js'
import { PRINCIPLES } from './rules.js'
import { UNIVERSE, monthlyReturn as assetMonthlyReturn, stressAmp } from './assets.js'

// ————— The walk-forward proving ground —————
// Freeze the rules at date T using only data knowable at T, step one release
// forward, score every decision against what actually happened, repeat across
// twenty-two years. Nothing here peeks: the percentile history is expanding,
// the dial settles through the same deadband the live machine uses, and each
// decision is graded strictly on the following release. The harness turns
// every rule from an opinion into a base rate.

export const BACKTEST_SEED = 20040705
export const BACKTEST_MONTHS = 264 // twenty-two years of monthly releases

// The shared model-consistent return generator lives in assets.js; the
// harness asks whether the rules extract the structure the world actually
// has — including the noise that hides it. `common` is the month's market
// shock, drawn once and shared across assets to create correlation.
const monthlyReturn = (a, reading, rng, common) => assetMonthlyReturn(a, reading, rng, normal, common)

const basket = (rets, ids) => ids.reduce((s, id) => s + rets[id], 0) / ids.length

// The all-weather baseline every tilt is judged against.
const BASELINE = ['usEq', 'ust10', 'tips', 'gold', 'gsci', 'cash']

// Each principle's THEN expressed as a long/short payoff on next-period
// returns; a hit is a positive payoff. P·04 claims the baseline beats
// chasing the top-scored asset when nothing has surprised.
const PRINCIPLE_PAYOFF = {
  'P·01': (r) => r.gsci - r.ust10,
  'P·02': (r) => r.tips - r.ust10,
  'P·03': (r) => (r.gold + r.gsci) / 2 - r.usEq,
  'P·04': (r, top) => basket(r, BASELINE) - r[top],
  'P·05': (r) => (r.usEq + r.igc) / 2 - r.gold,
  'P·06': (r) => r.ust30 - r.fxc,
}

// The compass quadrants' favored assets, graded against the baseline.
const REGIME_BASKET = {
  'rising-rising': ['gsci', 'gold', 'tips'],
  'rising-falling': ['usEq', 'igc'],
  'falling-rising': ['gold', 'tips'],
  'falling-falling': ['ust10', 'ust30'],
}

// Sleeve proxies for the book: beta → baseline, alpha → fired-principle
// payoffs, performing credit → IG, opportunistic → EM debt, powder → cash.
function bookReturn(weights, rets, alphaPayoff) {
  const sleeves = [
    basket(rets, BASELINE),
    alphaPayoff,
    rets.igc,
    rets.emd,
    rets.cash,
  ]
  return sleeves.reduce((s, r, k) => s + (weights[k] / 100) * r, 0)
}

export function runBacktest(seed = BACKTEST_SEED, months = BACKTEST_MONTHS) {
  const rng = mulberry32(seed)

  const principles = Object.fromEntries(PRINCIPLES.map((p) => [p.id, { fires: 0, hits: 0 }]))
  const regimes = Object.fromEntries(Object.keys(QUADRANTS).map((k) => [k, { n: 0, hits: 0 }]))
  const dialCalls = { offense: { n: 0, hits: 0 }, defense: { n: 0, hits: 0 } }

  let reading = null
  let cycle = CYCLE0
  let hist = []
  let dial = dialFrom(proxyScores(CYCLE0))
  let prevW = weightsFor(dial)
  let prevWRaw = prevW
  let turnSettled = 0
  let turnRaw = 0

  let navManaged = 1
  let navFixed = 1
  let peakManaged = 1
  let maxDD = 0
  const fixedW = weightsFor(50)
  const bookRets = []
  const fixedRets = []

  // Pending decisions from T, graded when T+1 realizes.
  let pending = null

  for (let t = 0; t < months; t++) {
    reading = drawReading(rng, reading)
    cycle = evolveCycle(rng, cycle, reading)

    // Realize T's returns and grade T−1's decisions before deciding anew.
    // One market shock per month, shared across assets and amplified in stress.
    const common = normal(rng) * stressAmp(reading)
    const rets = Object.fromEntries(UNIVERSE.map((a) => [a.id, monthlyReturn(a, reading, rng, common)]))
    if (pending) {
      for (const id of pending.fired) {
        principles[id].fires += 1
        if (PRINCIPLE_PAYOFF[id](rets, pending.top) > 0) principles[id].hits += 1
      }
      const base = basket(rets, BASELINE)
      regimes[pending.regime].n += 1
      if (basket(rets, REGIME_BASKET[pending.regime]) > base) regimes[pending.regime].hits += 1

      if (pending.posture) {
        const call = dialCalls[pending.posture]
        call.n += 1
        const tightened = cycle.hySpread < pending.hySpread
        if ((pending.posture === 'offense') === tightened) call.hits += 1
      }

      const fired = pending.fired
      const alpha = fired.length
        ? fired.reduce((s, id) => s + PRINCIPLE_PAYOFF[id](rets, pending.top), 0) / fired.length
        : 0
      const rManaged = bookReturn(pending.weights, rets, alpha)
      const rFixed = bookReturn(fixedW, rets, alpha)
      navManaged *= 1 + rManaged / 100
      navFixed *= 1 + rFixed / 100
      peakManaged = Math.max(peakManaged, navManaged)
      maxDD = Math.max(maxDD, 1 - navManaged / peakManaged)
      bookRets.push(rManaged)
      fixedRets.push(rFixed)
    }

    // Decide at T with only what is knowable at T.
    hist = [...hist, cycle].slice(-260)
    const newComposite = dialFrom(proxyScores(cycle, hist))
    const newDial = settleDial(dial, newComposite)
    const w = weightsFor(newDial)
    const wRaw = weightsFor(newComposite)
    turnSettled += w.reduce((s, x, k) => s + Math.abs(x - prevW[k]), 0) / 2
    turnRaw += wRaw.reduce((s, x, k) => s + Math.abs(x - prevWRaw[k]), 0) / 2
    prevW = w
    prevWRaw = wRaw
    dial = newDial

    const scored = UNIVERSE.map((a) => ({ id: a.id, s: a.bG * reading.g + a.bI * reading.i }))
    pending = {
      fired: PRINCIPLES.filter((p) => p.test(reading.g, reading.i)).map((p) => p.id),
      top: scored.sort((x, y) => y.s - x.s)[0].id,
      regime: regimeOf(reading).key,
      posture: dial >= 65 ? 'offense' : dial < 35 ? 'defense' : null,
      hySpread: cycle.hySpread,
      weights: w,
    }
  }

  const graded = months - 1
  const mean = bookRets.reduce((s, r) => s + r, 0) / bookRets.length
  const volM = Math.sqrt(bookRets.reduce((s, r) => s + (r - mean) ** 2, 0) / bookRets.length)
  const pct = (hits, n) => (n > 0 ? Math.round((100 * hits) / n) : null)

  return {
    seed,
    months: graded,
    years: Math.round(graded / 12),
    deadband: DIAL_DEADBAND,
    principles: PRINCIPLES.map((p) => ({
      id: p.id,
      then: p.then,
      fires: principles[p.id].fires,
      hitRate: pct(principles[p.id].hits, principles[p.id].fires),
    })),
    regimes: Object.entries(QUADRANTS).map(([key, q]) => ({
      key,
      label: q.label,
      n: regimes[key].n,
      hitRate: pct(regimes[key].hits, regimes[key].n),
    })),
    dial: {
      offense: { n: dialCalls.offense.n, hitRate: pct(dialCalls.offense.hits, dialCalls.offense.n) },
      defense: { n: dialCalls.defense.n, hitRate: pct(dialCalls.defense.hits, dialCalls.defense.n) },
    },
    turnover: {
      settled: +(turnSettled / months).toFixed(2),
      unsettled: +(turnRaw / months).toFixed(2),
    },
    book: {
      cagr: +((navManaged ** (12 / graded) - 1) * 100).toFixed(2),
      cagrFixed: +((navFixed ** (12 / graded) - 1) * 100).toFixed(2),
      vol: +(volM * Math.sqrt(12)).toFixed(2),
      maxDD: +(maxDD * 100).toFixed(1),
    },
    // The monthly return series (newest last), for the lookback slider.
    series: { managed: bookRets, fixed: fixedRets },
  }
}

// ————— Lookback-window statistics (the slider) —————
// Compound the trailing `years` of the monthly series into a time-weighted
// (annualized HPR) result: this is the strategy return, unaffected by the
// timing of any contributions — the correct measure for a systematically
// rebalanced book with no irregular cash flows. Money-weighted return (XIRR)
// is a separate figure that only becomes meaningful once real investor
// contributions and withdrawals exist; it is not computed here.
export function windowStats(series, years) {
  const monthly = series.slice(-Math.round(years * 12))
  const n = monthly.length
  if (!n) return null
  let nav = 1
  let peak = 1
  let maxDD = 0
  const navPath = [1]
  for (const r of monthly) {
    nav *= 1 + r / 100
    peak = Math.max(peak, nav)
    maxDD = Math.max(maxDD, 1 - nav / peak)
    navPath.push(nav)
  }
  const mean = monthly.reduce((s, r) => s + r, 0) / n
  const vol = Math.sqrt(monthly.reduce((s, r) => s + (r - mean) ** 2, 0) / n) * Math.sqrt(12)
  const cumulative = nav - 1
  const cagr = nav ** (12 / n) - 1
  return {
    months: n,
    cumulative: +(cumulative * 100).toFixed(1),
    cagr: +(cagr * 100).toFixed(2),
    vol: +vol.toFixed(2),
    maxDD: +(maxDD * 100).toFixed(1),
    sharpe: vol > 0 ? +(((cagr * 100 - 3.8) / vol)).toFixed(2) : 0,
    growthOf: +(10000 * nav).toFixed(0), // $10,000 invested at the start of the window
    navPath,
  }
}
