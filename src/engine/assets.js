// The investable universe. er = expected CAGR (%/yr, model assumption),
// vol = annualized volatility (%), bG/bI = growth/inflation surprise betas
// (score units per σ), bM = market ("risk-on/off") beta driving cross-asset
// correlation, carry = annual carry (%/yr).
export const UNIVERSE = [
  { id: 'usEq',  name: 'US Equities',                cls: 'Equity', er: 6.5, vol: 16,  bG: 1.0,  bI: -0.5, bM: 1.0,  carry: 1.5 },
  { id: 'dmEq',  name: 'Global Equities ex-US',      cls: 'Equity', er: 6.8, vol: 17,  bG: 0.9,  bI: -0.4, bM: 1.05, carry: 2.8 },
  { id: 'emEq',  name: 'EM Equities',                cls: 'Equity', er: 7.8, vol: 21,  bG: 1.1,  bI: -0.2, bM: 1.2,  carry: 3.0 },
  { id: 'ust10', name: 'US 10-Year Treasury',        cls: 'Rates',  er: 4.4, vol: 7,   bG: -0.5, bI: -0.9, bM: -0.35, carry: 0.4 },
  { id: 'ust30', name: 'US 30-Year Treasury',        cls: 'Rates',  er: 4.8, vol: 13,  bG: -0.7, bI: -1.3, bM: -0.45, carry: 0.6 },
  { id: 'tips',  name: 'US TIPS (ILB)',              cls: 'Rates',  er: 4.2, vol: 6,   bG: -0.3, bI: 0.8,  bM: -0.1, carry: 0.2 },
  { id: 'cgb',   name: 'Chinese Government Bonds',   cls: 'Rates',  er: 3.0, vol: 5,   bG: -0.3, bI: -0.4, bM: -0.15, carry: -0.5 },
  { id: 'igc',   name: 'IG Corporate Credit',        cls: 'Credit', er: 5.2, vol: 8,   bG: 0.4,  bI: -0.5, bM: 0.45, carry: 1.2 },
  { id: 'emd',   name: 'EM Local-Currency Debt',     cls: 'Credit', er: 6.4, vol: 12,  bG: 0.3,  bI: 0.1,  bM: 0.75, carry: 3.5 },
  { id: 'gold',  name: 'Gold',                       cls: 'Real',   er: 5.0, vol: 15,  bG: -0.4, bI: 0.9,  bM: -0.2, carry: -0.2 },
  { id: 'gsci',  name: 'Broad Commodities',          cls: 'Real',   er: 5.5, vol: 16,  bG: 0.6,  bI: 1.2,  bM: 0.5,  carry: 1.0 },
  { id: 'wti',   name: 'Crude Oil',                  cls: 'Real',   er: 5.8, vol: 30,  bG: 0.7,  bI: 1.4,  bM: 0.6,  carry: 4.0 },
  { id: 'cu',    name: 'Copper',                     cls: 'Real',   er: 6.2, vol: 24,  bG: 0.9,  bI: 0.8,  bM: 0.85, carry: 0.5 },
  { id: 'fxc',   name: 'G10 FX Carry Basket',        cls: 'FX',     er: 4.6, vol: 9,   bG: 0.5,  bI: 0.3,  bM: 0.7,  carry: 4.5 },
  // ————— New sleeves (roadmap item 8), through the full pipeline —————
  // Merger arb: a short-vol-like carry sleeve — earns the deal spread, loses
  // when deals break in a risk-off spasm (positive market beta). Volatility:
  // long convexity — bleeds premium in calm, pays off hard in a crash
  // (strongly negative market beta). Held together, the book runs net-short
  // vol in froth (arb carry) and net-long vol in despair (convexity), which
  // is the dial doing its job.
  { id: 'arb',   name: 'Merger Arbitrage',           cls: 'Merger Arb', er: 5.6, vol: 6.5, bG: 0.25, bI: -0.05, bM: 0.55, carry: 4.8 },
  { id: 'vix',   name: 'Volatility (Long Convexity)', cls: 'Volatility', er: 3.6, vol: 22,  bG: -0.35, bI: 0.15, bM: -1.05, carry: -3.2 },
  { id: 'cash',  name: 'T-Bills / Cash',             cls: 'Cash',   er: 3.8, vol: 0.6, bG: 0.0,  bI: 0.0,  bM: 0.0,  carry: 0.0 },
]

export const CASH_RATE = 3.8 // %/yr

export const SURPRISE_PP = 0.8 // % of monthly return per σ of surprise per unit beta
export const MARKET_VOL = 3.2 // % monthly market-factor shock per unit β (the correlation engine)

// The market shock amplifies in risk-off (growth-down) months — a
// deleveraging/liquidity spasm that hits every risk asset at once. This is
// the mechanism behind "correlations converge toward one in a crisis":
// calm months are macro-idiosyncratic, stressed months share one big shock.
export const stressAmp = (reading) => 1 + 2.2 * Math.max(0, -reading.g - 0.25 * reading.i)

// The canonical model-consistent monthly return: drift + macro-factor
// response + a shared market shock (the source of cross-asset correlation) +
// idiosyncratic noise. The backtest grades rules against it; the risk engine
// estimates covariance from it. `normal` is a draw function (rng) => N(0,1).
// `common` is the month's market shock, drawn once and shared across assets;
// omit it and each asset is driven by macro + idiosyncratic only.
export function monthlyReturn(a, reading, rng, normal, common = 0) {
  const idioVar = Math.max(0, (a.vol / Math.sqrt(12)) ** 2 - (MARKET_VOL * a.bM) ** 2)
  return (
    a.er / 12 +
    SURPRISE_PP * (a.bG * reading.g + a.bI * reading.i) +
    MARKET_VOL * a.bM * common +
    Math.sqrt(idioVar) * normal(rng)
  )
}

// score = βG·(growth surprise) + βI·(inflation surprise) + carry + (ER − cash)/10
// carry and the ER premium are expressed in the same units by dividing %/yr by 10.
export function scoreAsset(a, g, i) {
  return a.bG * g + a.bI * i + a.carry / 10 + (a.er - CASH_RATE) / 10
}

export const TIER_NAMES = [
  { numeral: 'I', name: 'Prime Allocations' },
  { numeral: 'II', name: 'Core Holdings' },
  { numeral: 'III', name: 'Ballast' },
  { numeral: 'IV', name: 'Underweight' },
  { numeral: 'V', name: 'Avoid / Short' },
]

// Rank the universe on the current surprises and split into five tiers,
// distributing all assets as evenly as possible (front tiers carry the
// remainder) so the whole universe is ranked however large it grows.
export function rankIntoTiers(g, i) {
  const scored = UNIVERSE.map((a) => ({ ...a, score: scoreAsset(a, g, i) })).sort(
    (x, y) => y.score - x.score,
  )
  const n = scored.length
  const base = Math.floor(n / TIER_NAMES.length)
  const extra = n % TIER_NAMES.length
  let cursor = 0
  return TIER_NAMES.map((t, k) => {
    const size = base + (k < extra ? 1 : 0)
    const assets = scored.slice(cursor, cursor + size)
    cursor += size
    return { ...t, assets }
  })
}
