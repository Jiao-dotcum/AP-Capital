import { mulberry32, normal } from './prng.js'
import { CASH_RATE } from './assets.js'

export const N_PATHS = 400
export const N_QUARTERS = 40 // ten years, quarterly steps
export const PAIRWISE_RHO = 0.25
const MC_SEED = 1971 // fixed seed: identical selection → identical fan

// Equal-weight portfolio moments. er/vol arrive in %, returned in decimals.
export function portfolioMoments(assets) {
  const n = assets.length
  if (n === 0) return null
  const w = 1 / n
  // er is a CAGR (geometric); arithmetic drift adds the variance correction.
  const mu = assets.reduce(
    (s, a) => s + w * (Math.log(1 + a.er / 100) + (a.vol / 100) ** 2 / 2),
    0,
  )
  let variance = 0
  for (let a = 0; a < n; a++) {
    for (let b = 0; b < n; b++) {
      const rho = a === b ? 1 : PAIRWISE_RHO
      variance += w * w * rho * (assets[a].vol / 100) * (assets[b].vol / 100)
    }
  }
  return { mu, sigma: Math.sqrt(variance) }
}

// 400 GBM paths of growth-of-100 over 10 years; percentile bands per quarter.
// Pass `override` moments (risk-parity weights on the Ledoit–Wolf covariance
// from risk.js) to replace the equal-weight ρ = 0.25 fallback.
export function simulateFan(assets, override = null) {
  const moments = override ?? portfolioMoments(assets)
  if (!moments) return null
  const { mu, sigma } = moments
  const rng = mulberry32(MC_SEED)
  const dt = 0.25
  const drift = (mu - (sigma * sigma) / 2) * dt
  const shockScale = sigma * Math.sqrt(dt)

  // values[q] = array of path values at quarter q (q = 0 is the start).
  const values = Array.from({ length: N_QUARTERS + 1 }, () => new Float64Array(N_PATHS))
  values[0].fill(100)
  for (let p = 0; p < N_PATHS; p++) {
    let s = 100
    for (let q = 1; q <= N_QUARTERS; q++) {
      s *= Math.exp(drift + shockScale * normal(rng))
      values[q][p] = s
    }
  }

  const pct = (sorted, q) => {
    const idx = q * (sorted.length - 1)
    const lo = Math.floor(idx)
    const hi = Math.ceil(idx)
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo)
  }
  const bands = values.map((row, q) => {
    const sorted = Float64Array.from(row).sort()
    return {
      q,
      p5: pct(sorted, 0.05),
      p25: pct(sorted, 0.25),
      p50: pct(sorted, 0.5),
      p75: pct(sorted, 0.75),
      p95: pct(sorted, 0.95),
    }
  })
  return { mu, sigma, bands, terminal: bands[N_QUARTERS] }
}

export const annualized = (terminalValue) => (terminalValue / 100) ** (1 / 10) - 1

// Analytic lognormal holding-period returns for the ledger.
// median = e^{(μ−σ²/2)·10} − 1 ; the 5th percentile subtracts 1.645·σ·√10
// in the exponent. With er a CAGR, (μ−σ²/2) = ln(1+er).
export function ledgerRow(a) {
  const m = Math.log(1 + a.er / 100)
  const sigma = a.vol / 100
  return {
    ...a,
    sharpe: (a.er - CASH_RATE) / a.vol,
    hprMedian: Math.exp(m * 10) - 1,
    hprP5: Math.exp(m * 10 - 1.645 * sigma * Math.sqrt(10)) - 1,
  }
}
