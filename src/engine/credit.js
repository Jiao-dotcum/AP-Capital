import { clamp } from './prng.js'
import { CYCLE0 } from './cycle.js'

// ————— The Performing Credit desk universe (simulated issuers) —————
// Structural fundamentals, from which everything downstream is computed:
// lev = net leverage (Debt/EBITDA, ×), cov = interest coverage (×),
// mult = enterprise value multiple (EV/EBITDA, ×) → asset value per unit of
// debt is mult/lev, av = annualized asset (unlevered) volatility, recovery =
// stressed recovery per 100, price = par-normalized calm-market price.
// Distance-to-default, PD, expected loss, and the fair spread are DERIVED
// from these — not hardcoded. (In the live path these come from SEC EDGAR
// XBRL; see src/live/edgar.js.)
export const ISSUERS = [
  { id: 'mer', name: 'Meridian Cable', sector: 'Communications', rating: 'B2', lev: 5.8, cov: 2.4, mult: 8.6, av: 0.22, recovery: 55, price: 94 },
  { id: 'iro', name: 'Ironline Freight', sector: 'Transport', rating: 'Ba3', lev: 3.4, cov: 3.6, mult: 9.2, av: 0.19, recovery: 62, price: 99 },
  { id: 'cas', name: 'Castellan Foods', sector: 'Consumer Staples', rating: 'Ba2', lev: 3.9, cov: 3.1, mult: 10.4, av: 0.14, recovery: 60, price: 100 },
  { id: 'van', name: 'Vantage Health', sector: 'Healthcare', rating: 'B1', lev: 4.8, cov: 2.6, mult: 9.0, av: 0.20, recovery: 58, price: 96 },
  { id: 'cor', name: 'Corinthian Leisure', sector: 'Lodging & Gaming', rating: 'B3', lev: 6.3, cov: 1.9, mult: 8.2, av: 0.30, recovery: 48, price: 87 },
  { id: 'atl', name: 'Atlas Specialty Chem', sector: 'Chemicals', rating: 'Ba3', lev: 4.1, cov: 3.0, mult: 8.8, av: 0.23, recovery: 57, price: 98 },
  { id: 'pal', name: 'Pallas Software', sector: 'Technology', rating: 'B2', lev: 6.8, cov: 2.2, mult: 11.5, av: 0.28, recovery: 38, price: 95 },
  { id: 'dor', name: 'Doric Energy', sector: 'Energy', rating: 'B1', lev: 3.2, cov: 4.2, mult: 7.4, av: 0.29, recovery: 65, price: 97 },
  { id: 'aeg', name: 'Aegis Brokers', sector: 'Financials', rating: 'B2', lev: 5.5, cov: 2.8, mult: 8.0, av: 0.24, recovery: 52, price: 96 },
  { id: 'tes', name: 'Tessera Building', sector: 'Industrials', rating: 'Caa1', lev: 7.1, cov: 1.5, mult: 8.4, av: 0.27, recovery: 34, price: 78 },
]

const RF = 0.03 // risk-free drift for the structural model
const HORIZON = 1 // years

// ————— Merton distance-to-default (structural) —————
// DtD = [ln(V/D) + (r − ½σ²)T] / (σ√T), with V/D = mult/lev and σ the
// asset volatility, stressed by the cycle. Assets are worth `mult` turns of
// EBITDA; debt is `lev` turns; default is V < D at the horizon.
export function mertonDtD(issuer, stressVol = 1) {
  const vd = issuer.mult / issuer.lev
  const sig = issuer.av * stressVol
  return (Math.log(vd) + (RF - 0.5 * sig * sig) * HORIZON) / (sig * Math.sqrt(HORIZON))
}

// The theoretical PD is N(−DtD), but the Gaussian tail is famously
// miscalibrated (the credit-spread puzzle). Like KMV's empirical EDF, we map
// distance-to-default to a probability through a calibration anchored to
// agency one-year default rates: DtD 6 → ~0.02%, 4 → ~0.3%, 3 → ~1.1%,
// 2 → ~4%, 1 → ~15%, 0 → ~35%.
export const pdFromDtD = (dd) => +clamp(0.55 * Math.exp(-1.3 * dd), 0.0001, 0.6).toFixed(4)

// ————— KMV-style structural unlevering (real issuers only) —————
// mertonDtD above needs the FIRM's asset value and volatility (`mult`, `av`),
// but those aren't observable for a real company — only its EQUITY value
// (market cap) and equity volatility (realized, from the price history) are.
// Equity is a call option on the firm's assets (Merton 1974): its value and
// volatility relate to the asset value/vol through two Black–Scholes
// equations. KMV inverts them by fixed-point iteration:
//   E    = V·N(d1) − D·e^(−rT)·N(d2)
//   σE·E = N(d1)·σV·V
// Solved here for (V, σV) given the OBSERVABLE (E, σE, D). This N() is
// numerical machinery for that inversion — a different job from pdFromDtD
// above, which deliberately avoids N(−DtD) for the final PD mapping because
// the Gaussian tail is miscalibrated against real default rates. Unlevering
// asset value from equity value has no such calibration problem; it's just
// solving two equations for two unknowns.
function erf(x) {
  const sign = x < 0 ? -1 : 1
  const ax = Math.abs(x)
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911
  const t = 1 / (1 + p * ax)
  const y = 1 - (((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t) * Math.exp(-ax * ax)
  return sign * y
}
const normCdf = (x) => 0.5 * (1 + erf(x / Math.SQRT2))

// A fixed iteration count (not a while-loop convergence check) keeps this
// deterministic (Invariant 3) — the same inputs always take the same number
// of steps. Throws rather than returning a garbage value on non-convergent
// or implausible input (the discipline that fixed the Ford Infinity bug):
// asset vol must land between 2% and the equity vol itself (equity is a
// levered claim, so it can only be MORE volatile than the assets beneath it,
// never less — a violation means the iteration diverged).
export function unleverAssetVol(equityValue, equityVolAnnual, debtFace, opts = {}) {
  const rf = opts.rf ?? RF
  const horizon = opts.horizon ?? HORIZON
  const iters = opts.iters ?? 60
  if (!(equityValue > 0 && equityVolAnnual > 0 && debtFace > 0)) {
    throw new Error('unleverAssetVol: equity value, equity vol, and debt must all be positive')
  }
  let V = equityValue + debtFace
  let sigV = (equityVolAnnual * equityValue) / V
  let Nd1 = 0, Nd2 = 0
  for (let k = 0; k < iters; k++) {
    const d1 = (Math.log(V / debtFace) + (rf + 0.5 * sigV * sigV) * horizon) / (sigV * Math.sqrt(horizon))
    const d2 = d1 - sigV * Math.sqrt(horizon)
    Nd1 = normCdf(d1)
    Nd2 = normCdf(d2)
    if (Nd1 < 1e-6) break
    V = (equityValue + debtFace * Math.exp(-rf * horizon) * Nd2) / Nd1
    sigV = (equityVolAnnual * equityValue) / (Nd1 * V)
  }
  if (!Number.isFinite(V) || !Number.isFinite(sigV) || sigV <= 0) {
    throw new Error('unleverAssetVol: did not converge to a plausible result')
  }
  // A finite number after 60 steps isn't the same as a solution — plug
  // (V, σV) back into the equity-value equation and require it to actually
  // reproduce the observed equity value within 2%. Fixed-point iteration
  // can oscillate near a boundary (a deeply distressed firm, debt close to
  // asset value) without ever technically diverging to Infinity/NaN; this
  // is the check that catches THAT case instead of silently returning a
  // number that only looks plausible.
  const reconstructedEquity = V * Nd1 - debtFace * Math.exp(-rf * horizon) * Nd2
  if (Math.abs(reconstructedEquity - equityValue) / equityValue > 0.02) {
    throw new Error('unleverAssetVol: fixed-point iteration did not converge (equity value mismatch)')
  }
  return { assetValue: V, assetVol: clamp(sigV, 0.02, equityVolAnnual) }
}

// Annualized realized volatility from a daily close series: stdev of daily
// log returns × √252. Needs enough history that one noisy week can't swing
// the estimate — 20 trading days is a floor, not a target (the caller
// requests a longer lookback; see api/_lib/marketdata.js).
export function realizedVolAnnual(closes) {
  if (!Array.isArray(closes) || closes.length < 20) {
    throw new Error('realizedVolAnnual: need at least 20 daily closes')
  }
  const rets = []
  for (let i = 1; i < closes.length; i++) rets.push(Math.log(closes[i] / closes[i - 1]))
  const mean = rets.reduce((s, r) => s + r, 0) / rets.length
  const variance = rets.reduce((s, r) => s + (r - mean) ** 2, 0) / (rets.length - 1)
  return Math.sqrt(variance * 252)
}

// Starting calm-market bond price by rating, matching the simulated desk's
// own convention above (Ba-ish names near par, single-B names in the
// mid-90s, Caa well below). This is only the initial reference point —
// screenPerforming recomputes price dynamically from divergence and cycle
// stress on every screen, real issuers included.
const START_PRICE_BY_RATING = { Baa1: 100, Baa2: 100, Baa3: 99, Ba1: 99, Ba2: 98, Ba3: 97, B1: 96, B2: 94, B3: 88, Caa1: 78 }

// Assemble one real issuer into the exact shape screenPerforming expects:
// leverage and coverage come straight from the SEC filing (deriveFundamentals,
// src/live/edgar.js); the asset multiple and asset vol come from KMV-
// unlevering the firm's real equity market cap and realized equity
// volatility against that same filed debt. Throws (fails loud, never
// silently estimates) if any required live input is missing or the KMV
// solve doesn't converge to something plausible — the caller excludes the
// name from the traded book rather than trading on a garbage number.
export function buildRealIssuer(meta, fundamentals, market) {
  const { lev, cov, debt, ebitda } = fundamentals
  const { price, sharesOut, equityVolAnnual } = market
  if (!(Number.isFinite(price) && price > 0)) throw new Error(`${meta.ticker}: no live equity price`)
  if (!(Number.isFinite(sharesOut) && sharesOut > 0)) throw new Error(`${meta.ticker}: shares outstanding missing from filing`)
  if (!(Number.isFinite(equityVolAnnual) && equityVolAnnual > 0)) throw new Error(`${meta.ticker}: could not compute realized equity vol`)
  if (!(Number.isFinite(ebitda) && ebitda > 0)) throw new Error(`${meta.ticker}: EBITDA not positive — cannot form an EV multiple`)
  const equityValue = price * sharesOut
  const { assetValue, assetVol } = unleverAssetVol(equityValue, equityVolAnnual, debt)
  return {
    id: meta.ticker,
    name: meta.name,
    sector: meta.sector,
    rating: meta.rating,
    recovery: meta.recovery,
    lev,
    cov,
    mult: +(assetValue / ebitda).toFixed(1),
    av: +assetVol.toFixed(3),
    price: START_PRICE_BY_RATING[meta.rating] ?? 95,
    source: 'EDGAR+KMV',
  }
}

// The trading desk's actual universe. Real, live-verified issuers REPLACE
// the simulated ten outright — they are not blended. A book that mixes real
// companies with invented ones can't be reasoned about: a weight, a sector
// exposure, or a P&L number would be part measurement and part fiction with
// no way to separate them.
//
// The fallback to ISSUERS is for when no real name has cleared (backend
// unconfigured, or every issuer failed its data gates). That keeps the desk
// renderable and the paper book running (Invariant 5), and those rows are
// labeled SIM in the UI. Note what does NOT reach here: the offline
// cov/lev/mult/av estimates in BENCHMARKS (src/live/edgar.js) are typed-in
// placeholders for the benchmark panel — only `buildRealIssuer` output,
// stamped `EDGAR+KMV`, is ever traded, so a real company NAME can never
// appear on this desk carrying made-up numbers.
export function tradedIssuers(realIssuers) {
  return realIssuers && realIssuers.length ? realIssuers : ISSUERS
}

// ————— The one-year ratings-transition matrix (Markov migration) —————
// Rows = rating bucket today, columns = bucket in one year. Rough
// agency-style through-the-cycle probabilities; each row sums to 1.
export const RATING_BUCKETS = ['Baa', 'Ba', 'B', 'Caa', 'Default']
export const TRANSITION = {
  //        Baa    Ba     B      Caa    Default
  Baa: [0.902, 0.078, 0.015, 0.004, 0.001],
  Ba: [0.061, 0.833, 0.083, 0.016, 0.007],
  B: [0.004, 0.052, 0.844, 0.068, 0.032],
  Caa: [0.001, 0.012, 0.093, 0.774, 0.12],
}

export const bucketOf = (rating) => {
  const g = rating[0] === 'A' ? 'Baa' : rating.slice(0, rating.search(/\d/)) || rating
  if (g.startsWith('Baa') || g.startsWith('A')) return 'Baa'
  if (g.startsWith('Ba')) return 'Ba'
  if (g.startsWith('Caa') || g.startsWith('Ca') || g.startsWith('C')) return 'Caa'
  if (g.startsWith('B')) return 'B'
  return 'B'
}

// Agency default + downgrade probability for an issuer's bucket over one year.
export function migrationOf(rating) {
  const b = bucketOf(rating)
  const row = TRANSITION[b]
  const cols = RATING_BUCKETS
  const bi = cols.indexOf(b)
  const pDefault = row[cols.indexOf('Default')]
  let pDown = 0
  for (let k = 0; k < cols.length; k++) if (k > bi) pDown += row[k]
  return { bucket: b, pDefault, pDown, pStable: row[bi] }
}

// Deterministic idiosyncratic wobble per (issuer, cycle state) — no rng, so
// the desk re-screens identically for a given cycle print.
function hash01(s) {
  let h = 2166136261
  for (const ch of s) {
    h ^= ch.charCodeAt(0)
    h = Math.imul(h, 16777619)
  }
  return ((h >>> 0) % 1000) / 1000
}

// Screening thresholds (the Panossian function)
export const SCREENS = {
  minCoverage: 2.0, // interest coverage floor (×)
  minDD: 2.0, // Merton distance-to-default floor (σ)
  minSpreadPerTurn: 60, // bp of spread per turn of leverage
  minMoS: 0.55, // downside (recovery) value / price floor
  richDivergence: -60, // bp — consensus already loves it
  primeDivergence: 80, // bp — model disagrees with consensus, in our favor
  maxName: 22, // single-name concentration cap (% of book)
  maxSector: 34, // sector concentration cap (% of book)
}

// Calm-market quoted spread by rating bucket (bp). The market's actual price;
// the model-fair spread from expected loss is what we measure it against.
const QUOTED = { Baa: 190, Ba: 285, B: 455, Caa: 850 }
const RATING_QUOTE = { Ba2: 260, Ba3: 300, B1: 400, B2: 470, B3: 620, Caa1: 850 }

// Fair spread from fundamentals: annualized expected loss plus a risk/liquidity
// premium (larger for more volatile assets — the part of a spread that is not
// expected loss but compensation for bearing the risk).
function fairSpreadOf(issuer, stressVol) {
  const dd = mertonDtD(issuer, stressVol)
  const pd = pdFromDtD(dd)
  const lgd = 1 - issuer.recovery / 100
  const el = pd * lgd // annualized expected loss, fraction
  const premium = 90 + 360 * issuer.av
  return { dd, pd, lgd, el, fairSpread: Math.round((el * 1e4) / HORIZON + premium) }
}

// Second-level thinking, mechanized as consensus divergence: model-fair
// spread vs what the market prices. Alpha is only permitted where the model
// disagrees AND can say why the consensus is wrong. `issuers` defaults to
// the static snapshot; the mandate backtest passes EVOLVED issuer states
// (time-varying lev/cov/mult, migrated ratings) through the same screen.
export function screenPerforming(cycle, issuers = ISSUERS) {
  // Cycle stress raises asset volatility (wider PDs) and, separately, the
  // market's demanded spread.
  const stressVol = clamp(0.72 + (cycle.hySpread / CYCLE0.hySpread) * 0.4, 0.6, 2.2)
  const scale = cycle.hySpread / CYCLE0.hySpread
  const rows = issuers.map((a) => {
    const { dd, pd, lgd, el, fairSpread } = fairSpreadOf(a, stressVol)
    // Model-fair spread = expected-loss + premium, mildly cycle-scaled.
    const modelSpread = Math.round(fairSpread * (0.6 + 0.4 * scale))
    // Market spread = the rating's calm quote, cycle-widened, with a
    // deterministic idiosyncratic wobble. Divergence is market vs model —
    // the market over-charges for quality and under-charges for the tail.
    const quote = RATING_QUOTE[a.rating] ?? QUOTED[bucketOf(a.rating)]
    const wobble = 0.82 + 0.36 * hash01(a.id + cycle.hySpread)
    const marketSpread = Math.round(quote * (0.45 + 0.55 * scale) * wobble)
    const divergence = marketSpread - modelSpread
    const price = +clamp(a.price - divergence / 40 - (cycle.hySpread - CYCLE0.hySpread) / 60, 55, 101).toFixed(1)
    const mos = a.recovery / price // downside value over price
    const spreadPerTurn = Math.round(marketSpread / a.lev)
    const mig = migrationOf(a.rating)

    let verdict = 'HOLD'
    let reason = ''
    if (a.cov < SCREENS.minCoverage) {
      verdict = 'REJECT'
      reason = `coverage ${a.cov.toFixed(1)}× < ${SCREENS.minCoverage.toFixed(1)}× floor`
    } else if (dd < SCREENS.minDD) {
      verdict = 'REJECT'
      reason = `distance-to-default ${dd.toFixed(1)}σ < ${SCREENS.minDD.toFixed(1)}σ floor`
    } else if (mos < SCREENS.minMoS) {
      verdict = 'REJECT'
      reason = 'fails margin of safety — downside does not return capital'
    } else if (divergence < SCREENS.richDivergence) {
      verdict = 'AVOID'
      reason = 'priced for perfection — the admiration is in the price'
    } else if (spreadPerTurn < SCREENS.minSpreadPerTurn) {
      verdict = 'REJECT'
      reason = `${spreadPerTurn} bp per turn < ${SCREENS.minSpreadPerTurn} bp floor`
    } else if (divergence > SCREENS.primeDivergence) {
      verdict = 'PRIME'
      reason = 'consensus overstates the risk; the model can say why'
    }
    return {
      ...a,
      dd: +dd.toFixed(1),
      pd,
      el: +(el * 100).toFixed(2),
      elSpread: Math.round((el * 1e4) / HORIZON),
      pDefault1y: mig.pDefault,
      pDowngrade1y: mig.pDown,
      bucket: mig.bucket,
      modelSpread,
      marketSpread,
      divergence,
      price,
      mos,
      spreadPerTurn,
      verdict,
      reason,
    }
  })

  // Positions are sized by margin of safety, then capped for concentration.
  const eligible = (r) => r.verdict === 'PRIME' || r.verdict === 'HOLD'
  const mosSum = rows.filter(eligible).reduce((s, r) => s + r.mos, 0)
  for (const r of rows) r.weight = mosSum && eligible(r) ? (r.mos / mosSum) * 100 : 0
  applyConcentrationCaps(rows, eligible)
  return rows
}

// Iteratively cap single-name and sector weights, redistributing the excess
// to uncapped eligible names in proportion to their margin of safety. The
// hard risk gate on concentration, before anything reaches the committee.
function applyConcentrationCaps(rows, eligible) {
  for (let pass = 0; pass < 24; pass++) {
    let spill = 0
    for (const r of rows) {
      if (r.weight > SCREENS.maxName) {
        spill += r.weight - SCREENS.maxName
        r.weight = SCREENS.maxName
        r.capped = 'name'
      }
    }
    const bySector = {}
    for (const r of rows) if (eligible(r)) bySector[r.sector] = (bySector[r.sector] || 0) + r.weight
    for (const [sec, tot] of Object.entries(bySector)) {
      if (tot > SCREENS.maxSector) {
        const factor = SCREENS.maxSector / tot
        for (const r of rows) {
          if (eligible(r) && r.sector === sec) {
            spill += r.weight * (1 - factor)
            r.weight *= factor
            r.capped = r.capped || 'sector'
          }
        }
      }
    }
    if (spill < 0.05) break
    // Redistribute spill to names below the single-name cap.
    const room = rows.filter((r) => eligible(r) && r.weight < SCREENS.maxName - 0.01)
    const base = room.reduce((s, r) => s + r.mos, 0)
    if (!base) break
    for (const r of room) r.weight += spill * (r.mos / base)
  }
}

export const secondLevelThesis = (r) => {
  if (r.verdict === 'PRIME')
    return `Crowd sees the ${r.sector.toLowerCase()} headline and sells; model sees ${r.cov.toFixed(1)}× coverage, ${r.dd.toFixed(1)}σ to default, and a ${r.recovery} recovery under the price.`
  if (r.verdict === 'AVOID')
    return 'Good credit, universally admired — first-level buyers have already paid for the quality.'
  if (r.verdict === 'REJECT') return `Rejected at the gate: ${r.reason}.`
  return 'Consensus is roughly right; earn the carry, take no view.'
}

// ————— The Opportunistic desk's automatable proxies —————
// True distressed debt is negotiated and access-gated; the desk trades
// listed proxies on distress triggers instead.
export function proxyVehicles(cycle) {
  const s = (cycle.hySpread - 220) / (1250 - 220)
  return [
    { name: 'HY Index ETF', metric: 'OAS', value: `${cycle.hySpread} bp` },
    { name: 'Senior Loan ETF', metric: 'Yield', value: `${(4.9 + (cycle.hySpread / 100) * 0.62).toFixed(1)}%` },
    { name: 'CLO BB Debt ETF', metric: 'Spread', value: `${Math.round(cycle.hySpread * 1.55)} bp` },
    { name: 'BDC Basket', metric: 'Price / NAV', value: `${(1.04 - 0.34 * s).toFixed(2)}×` },
    { name: 'Credit CEFs', metric: 'NAV Discount', value: `−${(3 + 11 * s).toFixed(1)}%` },
  ]
}
