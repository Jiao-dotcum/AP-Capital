import { mulberry32, normal, clamp } from './prng.js'
import { drawReading } from './machine.js'
import { CYCLE0, evolveCycle } from './cycle.js'
import { UNIVERSE, CASH_RATE, SURPRISE_PP, MARKET_VOL, monthlyReturn, stressAmp } from './assets.js'
import { BACKTEST_SEED, BACKTEST_MONTHS } from './backtest.js'

// ————— Real risk math —————
// Covariance estimated from monthly returns with Ledoit–Wolf shrinkage
// (replacing the flat ρ = 0.25), crisis-stressed correlations, four-season
// risk-parity sizing with the dial scaling gross, empirical CVaR, a
// drawdown-triggered de-risking schedule, and a block-bootstrap Monte Carlo
// with named crisis replays. Everything seeded, everything reproducible.

const IDS = UNIVERSE.map((a) => a.id)
const IDX = Object.fromEntries(IDS.map((id, k) => [id, k]))

// The same 22-year world the proving ground walked, consumed in the same
// draw order, so the covariance is estimated from the identical history.
let _hist = null
export function returnHistory(seed = BACKTEST_SEED, months = BACKTEST_MONTHS) {
  if (_hist && _hist.seed === seed && _hist.R.length === months) return _hist
  const rng = mulberry32(seed)
  let reading = null
  let cycle = CYCLE0
  const R = []
  const spreads = []
  for (let t = 0; t < months; t++) {
    reading = drawReading(rng, reading)
    cycle = evolveCycle(rng, cycle, reading)
    const common = normal(rng) * stressAmp(reading) // shared shock, amplified in stress
    R.push(UNIVERSE.map((a) => monthlyReturn(a, reading, rng, normal, common)))
    spreads.push(cycle.hySpread)
  }
  _hist = { seed, R, spreads }
  return _hist
}

// ————— Ledoit–Wolf constant-correlation shrinkage (2003) —————
export function ledoitWolf(R) {
  const T = R.length
  const k = R[0].length
  const mean = Array(k).fill(0)
  for (const row of R) for (let j = 0; j < k; j++) mean[j] += row[j] / T
  const X = R.map((row) => row.map((v, j) => v - mean[j]))

  const S = Array.from({ length: k }, () => Array(k).fill(0))
  for (const x of X) for (let i = 0; i < k; i++) for (let j = 0; j < k; j++) S[i][j] += (x[i] * x[j]) / T

  const sd = S.map((row, i) => Math.sqrt(row[i]))
  let rBar = 0
  for (let i = 0; i < k; i++) for (let j = 0; j < k; j++) if (i !== j) rBar += S[i][j] / (sd[i] * sd[j])
  rBar /= k * (k - 1)

  // Prior: constant correlation, sample variances on the diagonal.
  const F = S.map((row, i) => row.map((_, j) => (i === j ? S[i][i] : rBar * sd[i] * sd[j])))

  // π̂: asymptotic variance of the sample covariances.
  let pi = 0
  const piMat = Array.from({ length: k }, () => Array(k).fill(0))
  for (let i = 0; i < k; i++) {
    for (let j = 0; j < k; j++) {
      let s = 0
      for (const x of X) s += (x[i] * x[j] - S[i][j]) ** 2
      piMat[i][j] = s / T
      pi += piMat[i][j]
    }
  }

  // ρ̂: the part of π̂ the prior also has to estimate.
  let rho = 0
  for (let i = 0; i < k; i++) rho += piMat[i][i]
  for (let i = 0; i < k; i++) {
    for (let j = 0; j < k; j++) {
      if (i === j) continue
      let thII = 0
      let thJJ = 0
      for (const x of X) {
        thII += (x[i] * x[i] - S[i][i]) * (x[i] * x[j] - S[i][j])
        thJJ += (x[j] * x[j] - S[j][j]) * (x[i] * x[j] - S[i][j])
      }
      rho += (rBar / 2) * ((Math.sqrt(S[j][j] / S[i][i]) * thII) / T + (Math.sqrt(S[i][i] / S[j][j]) * thJJ) / T)
    }
  }

  // γ̂: misspecification of the prior.
  let gamma = 0
  for (let i = 0; i < k; i++) for (let j = 0; j < k; j++) gamma += (F[i][j] - S[i][j]) ** 2

  const delta = clamp((pi - rho) / gamma / T, 0, 1)
  const cov = S.map((row, i) => row.map((s, j) => delta * F[i][j] + (1 - delta) * s))
  return { cov, delta: +delta.toFixed(2), avgRho: +rBar.toFixed(2), sd }
}

// The risk-on cohort — where "correlations converge toward one in a crisis"
// actually bites. Averaging over the whole universe cancels (stock/bond pairs
// are negative by design), so the convergence is measured within this set.
export const RISK_ON = ['usEq', 'dmEq', 'emEq', 'igc', 'emd', 'gsci', 'wti', 'cu', 'fxc']

// Average pairwise correlation among a set of assets, from a covariance.
function avgPairRho(cov, ids) {
  let s = 0
  let n = 0
  for (let a = 0; a < ids.length; a++) {
    for (let b = a + 1; b < ids.length; b++) {
      const i = IDX[ids[a]]
      const j = IDX[ids[b]]
      s += cov[i][j] / Math.sqrt(cov[i][i] * cov[j][j])
      n += 1
    }
  }
  return n ? s / n : 0
}

// Risk-on correlation in the calm full history vs the crisis decile (worst
// 10% of months by HY spread widening).
export function crisisAvgRho(hist) {
  const { R, spreads } = hist
  const widen = spreads.map((s, t) => (t === 0 ? 0 : s - spreads[t - 1]))
  const cut = [...widen].sort((a, b) => b - a)[Math.floor(widen.length / 10)]
  const rows = R.filter((_, t) => widen[t] >= cut && t > 0)
  const full = ledoitWolf(R).cov
  const crisis = ledoitWolf(rows).cov
  return {
    fullRho: +avgPairRho(full, RISK_ON).toFixed(2),
    crisisRho: +avgPairRho(crisis, RISK_ON).toFixed(2),
    months: rows.length,
  }
}

// ————— Four-season risk parity, dial scaling gross —————
export const SEASONS = [
  { name: 'Rising Growth', ids: ['usEq', 'dmEq', 'emEq', 'igc', 'emd', 'gsci', 'wti', 'cu', 'fxc'] },
  { name: 'Falling Growth', ids: ['ust10', 'ust30', 'cgb'] },
  { name: 'Rising Inflation', ids: ['tips', 'gold', 'gsci', 'wti', 'cu'] },
  { name: 'Falling Inflation', ids: ['usEq', 'dmEq', 'ust10', 'ust30', 'igc'] },
]

const quad = (w, cov) => {
  let s = 0
  for (let i = 0; i < w.length; i++) for (let j = 0; j < w.length; j++) s += w[i] * cov[i][j] * w[j]
  return s
}

// Equalize each season's standalone risk (its own sub-portfolio volatility),
// then let capital fall out. Standalone-vol equalization is robust to hedge
// sleeves whose marginal contribution to the combined book is negative —
// which true equal-risk-contribution is not, since you cannot assign a hedge
// a positive risk share. The dial scales gross from 0.5× (deep froth) to
// 1.5× (deep despair); the balance sits in — or is borrowed from — cash.
export function seasonRiskParity(assets, cov, dial) {
  const ids = assets.filter((a) => a.id !== 'cash').map((a) => a.id)
  const pos = Object.fromEntries(ids.map((id, k) => [id, k]))
  const sub = ids.map((i) => ids.map((j) => cov[IDX[i]][IDX[j]]))

  const seasons = SEASONS.map((s) => ({ ...s, ids: s.ids.filter((id) => id in pos) })).filter((s) => s.ids.length)
  if (!seasons.length || !ids.length) return null

  // Within each season: inverse-vol weights (sum to 1).
  const base = seasons.map((s) => {
    const w = Array(ids.length).fill(0)
    let tot = 0
    for (const id of s.ids) tot += 1 / Math.sqrt(sub[pos[id]][pos[id]])
    for (const id of s.ids) w[pos[id]] = 1 / Math.sqrt(sub[pos[id]][pos[id]]) / tot
    return w
  })

  // Each season's standalone volatility, then weight inversely so every
  // season carries the same standalone risk.
  const vol = base.map((b) => Math.sqrt(Math.max(quad(b, sub), 1e-12)))
  let lam = vol.map((v) => 1 / v)
  const lamTot = lam.reduce((a, b) => a + b, 0)
  lam = lam.map((l) => l / lamTot)

  const gross = +(0.5 + dial / 100).toFixed(2)
  const w = Array(ids.length).fill(0)
  seasons.forEach((_, s) => base[s].forEach((b, k) => (w[k] += lam[s] * b)))

  // Standalone-risk share per season (equal by construction) and capital.
  const riskShare = lam.map((l, s) => l * vol[s])
  const riskTot = riskShare.reduce((a, b) => a + b, 0)
  const seasonsOut = seasons.map((s, k) => ({
    name: s.name,
    capital: Math.round(100 * gross * lam[k]),
    risk: Math.round((100 * riskShare[k]) / riskTot),
  }))

  const weights = Object.fromEntries(ids.map((id, k) => [id, gross * w[k]]))
  const cashW = +(1 - gross).toFixed(2)
  return { weights, cashW, gross, seasons: seasonsOut }
}

// GBM inputs for the fan: log drift and portfolio σ from the shrunk
// covariance (returns arrive in monthly %; σ annualizes by √12).
export function bookMoments(weights, cashW, cov) {
  let mu = cashW * Math.log(1 + CASH_RATE / 100)
  const wVec = IDS.map((id) => weights[id] ?? 0)
  for (const a of UNIVERSE) {
    const w = weights[a.id] ?? 0
    mu += w * (Math.log(1 + a.er / 100) + (a.vol / 100) ** 2 / 2)
  }
  const sigma = Math.sqrt(quad(wVec, cov) * 12) / 100
  return { mu, sigma }
}

// ————— Drawdown-triggered de-risking (feeds the hardstop) —————
export const DERISK_SCHEDULE = [
  { beyond: 0.0, gross: 1.0, note: 'full weight' },
  { beyond: 0.05, gross: 0.75, note: 'gross to 75%' },
  { beyond: 0.1, gross: 0.5, note: 'gross to 50%, hedges on' },
]

const deriskGross = (dd) => {
  let g = 1
  for (const s of DERISK_SCHEDULE) if (dd > s.beyond) g = s.gross
  return g
}

// ————— Block bootstrap: fat tails by resampling the history itself —————
export function blockBootstrap(hist, weights, cashW, { seed = 8128, paths = 400, months = 120, block = 6 } = {}) {
  const { R } = hist
  const wVec = IDS.map((id) => weights[id] ?? 0)
  const cashM = CASH_RATE / 12
  const bookRow = (row) => row.reduce((s, r, j) => s + wVec[j] * r, cashW * cashM) / 100

  const rng = mulberry32(seed)
  const terminals = new Float64Array(paths)
  const maxDDs = new Float64Array(paths)
  const monthly = []
  for (let p = 0; p < paths; p++) {
    let nav = 100
    let peak = 100
    let dd = 0
    let worst = 0
    for (let m = 0; m < months; m += block) {
      const start = Math.floor(rng() * (R.length - block))
      for (let b = 0; b < block && m + b < months; b++) {
        const r = bookRow(R[start + b])
        if (p < 50) monthly.push(r) // ES sample: raw book months, pre-derisk
        const g = deriskGross(dd)
        nav *= 1 + cashM / 100 + g * (r - cashM / 100)
        peak = Math.max(peak, nav)
        dd = 1 - nav / peak
        worst = Math.max(worst, dd)
      }
    }
    terminals[p] = nav
    maxDDs[p] = worst
  }
  const sortedT = Float64Array.from(terminals).sort()
  const sortedD = Float64Array.from(maxDDs).sort()
  const pct = (arr, q) => arr[Math.min(arr.length - 1, Math.floor(q * arr.length))]
  const sortedM = [...monthly].sort((a, b) => a - b)
  const es = (a) => {
    const n = Math.max(1, Math.floor((1 - a) * sortedM.length))
    return (sortedM.slice(0, n).reduce((s, r) => s + r, 0) / n) * 100
  }
  return {
    terminal: { p5: pct(sortedT, 0.05), p50: pct(sortedT, 0.5), p95: pct(sortedT, 0.95) },
    maxDD: { median: pct(sortedD, 0.5) * 100, p95: pct(sortedD, 0.95) * 100 },
    es95: +es(0.95).toFixed(2),
    es99: +es(0.99).toFixed(2),
  }
}

// ————— Named replays: scripted factor paths through the model's own betas.
// Each phase carries a macro state (g, i, amp) and a market-factor level mkt
// (units of the shared shock; negative = deleveraging), so equities crash and
// bonds catch the flight to quality — the same two channels as the bootstrap.
const script = (n, g, i, amp, mkt) => Array.from({ length: n }, () => ({ g, i, amp, mkt }))
export const REPLAYS = [
  { name: 'GFC 2008–09', months: [...script(16, -1.4, -0.5, 4, -1.4), ...script(8, 1.2, 0.3, 2, 0.6)] },
  { name: 'March 2020', months: [...script(2, -1.6, -0.9, 10, -3.2), ...script(4, 1.5, 0.2, 3, 1.0)] },
  { name: '2022 — Both Down', months: script(10, -0.3, 1.4, 2, -0.6) },
]

export function runReplays(weights, cashW) {
  const cashM = CASH_RATE / 12
  return REPLAYS.map((rp) => {
    let nav = 100
    let peak = 100
    let worst = 0
    for (const m of rp.months) {
      let r = cashW * cashM
      for (const a of UNIVERSE) {
        const w = weights[a.id] ?? 0
        r += w * (a.er / 12 + m.amp * SURPRISE_PP * (a.bG * m.g + a.bI * m.i) + MARKET_VOL * a.bM * m.mkt)
      }
      nav *= 1 + r / 100
      peak = Math.max(peak, nav)
      worst = Math.max(worst, 1 - nav / peak)
    }
    return { name: rp.name, months: rp.months.length, total: +(nav - 100).toFixed(1), maxDD: +(worst * 100).toFixed(1) }
  })
}

// ————— The report the dashboard reads —————
let _lw = null
export function buildRiskReport(assets, dial) {
  if (!assets.length) return null
  const hist = returnHistory()
  if (!_lw) _lw = ledoitWolf(hist.R)
  const rp = seasonRiskParity(assets, _lw.cov, dial)
  if (!rp) return null
  const crisis = crisisAvgRho(hist)
  return {
    lw: { avgRho: _lw.avgRho, delta: _lw.delta },
    crisis,
    rp,
    moments: bookMoments(rp.weights, rp.cashW, _lw.cov),
    boot: blockBootstrap(hist, rp.weights, rp.cashW),
    replays: runReplays(rp.weights, rp.cashW),
    schedule: DERISK_SCHEDULE,
  }
}
