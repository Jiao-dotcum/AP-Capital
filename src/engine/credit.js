import { clamp } from './prng.js'
import { CYCLE0 } from './cycle.js'

// ————— The Performing Credit desk universe (simulated issuers) —————
// lev = net leverage (×), cov = interest coverage (×), dd = Merton
// distance-to-default (σ), recovery = stressed recovery value per 100,
// price = par-normalized price in a calm market, fairBase = model-fair
// spread (bp) when the HY index sits at its 420bp base.
export const ISSUERS = [
  { id: 'mer', name: 'Meridian Cable', sector: 'Communications', rating: 'B2', lev: 5.8, cov: 2.4, dd: 2.6, recovery: 55, price: 94, fairBase: 520 },
  { id: 'iro', name: 'Ironline Freight', sector: 'Transport', rating: 'Ba3', lev: 3.4, cov: 3.6, dd: 3.8, recovery: 62, price: 99, fairBase: 330 },
  { id: 'cas', name: 'Castellan Foods', sector: 'Consumer Staples', rating: 'Ba2', lev: 3.9, cov: 3.1, dd: 3.5, recovery: 60, price: 100, fairBase: 300 },
  { id: 'van', name: 'Vantage Health', sector: 'Healthcare', rating: 'B1', lev: 4.8, cov: 2.6, dd: 2.9, recovery: 58, price: 96, fairBase: 430 },
  { id: 'cor', name: 'Corinthian Leisure', sector: 'Lodging & Gaming', rating: 'B3', lev: 6.3, cov: 1.9, dd: 1.9, recovery: 48, price: 87, fairBase: 680 },
  { id: 'atl', name: 'Atlas Specialty Chem', sector: 'Chemicals', rating: 'Ba3', lev: 4.1, cov: 3.0, dd: 3.2, recovery: 57, price: 98, fairBase: 360 },
  { id: 'pal', name: 'Pallas Software', sector: 'Technology', rating: 'B2', lev: 6.8, cov: 2.2, dd: 2.4, recovery: 38, price: 95, fairBase: 560 },
  { id: 'dor', name: 'Doric Energy', sector: 'Energy', rating: 'B1', lev: 3.2, cov: 4.2, dd: 3.0, recovery: 65, price: 97, fairBase: 410 },
  { id: 'aeg', name: 'Aegis Brokers', sector: 'Financials', rating: 'B2', lev: 5.5, cov: 2.8, dd: 2.8, recovery: 52, price: 96, fairBase: 470 },
  { id: 'tes', name: 'Tessera Building', sector: 'Industrials', rating: 'Caa1', lev: 7.1, cov: 1.5, dd: 1.4, recovery: 34, price: 78, fairBase: 880 },
]

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
  minSpreadPerTurn: 90, // bp of spread per turn of leverage
  minMoS: 0.55, // downside (recovery) value / price floor
  richDivergence: -60, // bp — consensus already loves it
  primeDivergence: 80, // bp — model disagrees with consensus, in our favor
}

// Second-level thinking, mechanized as consensus divergence: model-fair
// spread vs what the market prices. Alpha is only permitted where the model
// disagrees AND can say why the consensus is wrong.
export function screenPerforming(cycle) {
  const scale = cycle.hySpread / CYCLE0.hySpread
  const rows = ISSUERS.map((a) => {
    const modelSpread = Math.round(a.fairBase * scale)
    const wobble = 0.78 + 0.5 * hash01(a.id + cycle.hySpread)
    const marketSpread = Math.round(modelSpread * wobble)
    const divergence = marketSpread - modelSpread
    const price = +clamp(a.price - divergence / 40 - (cycle.hySpread - CYCLE0.hySpread) / 60, 55, 101).toFixed(1)
    const mos = a.recovery / price // downside value over price
    const spreadPerTurn = Math.round(marketSpread / a.lev)

    let verdict = 'HOLD'
    let reason = ''
    if (a.cov < SCREENS.minCoverage) {
      verdict = 'REJECT'
      reason = `coverage ${a.cov.toFixed(1)}× < ${SCREENS.minCoverage.toFixed(1)}× floor`
    } else if (a.dd < SCREENS.minDD) {
      verdict = 'REJECT'
      reason = `distance-to-default ${a.dd.toFixed(1)}σ < ${SCREENS.minDD.toFixed(1)}σ floor`
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
    return { ...a, modelSpread, marketSpread, divergence, price, mos, spreadPerTurn, verdict, reason }
  })

  // Positions are sized by margin of safety — distance between price and
  // downside value — never by upside potential.
  const book = rows.filter((r) => r.verdict === 'PRIME' || r.verdict === 'HOLD')
  const mosSum = book.reduce((s, r) => s + r.mos, 0)
  for (const r of rows) {
    r.weight = mosSum && (r.verdict === 'PRIME' || r.verdict === 'HOLD') ? (r.mos / mosSum) * 100 : 0
  }
  return rows
}

export const secondLevelThesis = (r) => {
  if (r.verdict === 'PRIME')
    return `Crowd sees the ${r.sector.toLowerCase()} headline and sells; model sees ${r.cov.toFixed(1)}× coverage and a ${r.recovery} recovery under the price.`
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
