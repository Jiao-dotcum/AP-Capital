import { clamp } from './prng.js'

export const SIGMA_MAX = 1.6

// Priced-in (consensus) constants that live surprises are measured against.
export const PRICED_IN = {
  gdpSaar: 2.0, // %, real GDP SAAR
  coreCpiYoY: 2.8, // %
  policyRate: 4.375, // %, midpoint of target range
  gdpSigma: 0.9, // pp of GDP per 1σ of growth surprise
  cpiSigma: 0.35, // pp of CPI per 1σ of inflation surprise
}

// Draw the next (growth, inflation) surprise pair. Mildly mean-reverting so
// the compass trail wanders rather than teleporting.
export function drawReading(rng, prev) {
  const shock = () => (rng() + rng() + rng()) / 1.5 - 1 // approx-normal in [-1, 1]
  const g = clamp((prev ? 0.45 * prev.g : 0) + 1.25 * shock(), -SIGMA_MAX, SIGMA_MAX)
  const i = clamp((prev ? 0.45 * prev.i : 0) + 1.25 * shock(), -SIGMA_MAX, SIGMA_MAX)
  return { g: +g.toFixed(2), i: +i.toFixed(2), source: 'simulated' }
}

// The three data releases implied by the current surprise state.
export function releasesFrom({ g, i }) {
  const pol = clamp(0.6 * i + 0.4 * g, -SIGMA_MAX, SIGMA_MAX)
  return [
    {
      name: 'Real GDP, SAAR',
      period: 'Q2 2026',
      priced: PRICED_IN.gdpSaar,
      actual: PRICED_IN.gdpSaar + PRICED_IN.gdpSigma * g,
      sigma: g,
    },
    {
      name: 'Core CPI, YoY',
      period: 'Jun 2026',
      priced: PRICED_IN.coreCpiYoY,
      actual: PRICED_IN.coreCpiYoY + PRICED_IN.cpiSigma * i,
      sigma: i,
    },
    {
      name: 'Policy Rate, Target',
      period: 'Jul 2026',
      priced: PRICED_IN.policyRate,
      actual: PRICED_IN.policyRate + 0.25 * pol,
      sigma: pol,
    },
  ]
}

export const QUADRANTS = {
  'rising-rising': {
    key: 'rising-rising',
    label: 'Rising Growth · Rising Inflation',
    favored: 'Commodities · Gold · Inflation-Linked Bonds',
  },
  'rising-falling': {
    key: 'rising-falling',
    label: 'Rising Growth · Falling Inflation',
    favored: 'Equities · Corporate Credit',
  },
  'falling-rising': {
    key: 'falling-rising',
    label: 'Falling Growth · Rising Inflation',
    favored: 'Gold · Inflation-Linked Bonds',
  },
  'falling-falling': {
    key: 'falling-falling',
    label: 'Falling Growth · Falling Inflation',
    favored: 'Nominal Bonds',
  },
}

export function regimeOf({ g, i }) {
  const key = `${g >= 0 ? 'rising' : 'falling'}-${i >= 0 ? 'rising' : 'falling'}`
  return QUADRANTS[key]
}

// The three gears of the machine, mildly coupled to the current reading.
export function gearsFrom({ g, i }) {
  return {
    productivity: 1.8, // %/yr, multi-decade
    shortCyclePct: clamp(58 + 14 * g, 4, 96), // % of the way through the cycle
    debtServiceRatio: clamp(20.4 + 1.1 * i + 0.6 * g, 14, 26), // % of household income
    debtServiceThreshold: 22,
  }
}

// Tail-loss probability rises with the magnitude of macro surprise.
export const RUIN_CEILING = 0.025
export function riskOfRuin({ g, i }) {
  return 0.006 + 0.012 * (Math.abs(g) + Math.abs(i))
}
