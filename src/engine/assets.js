// The investable universe. er = expected CAGR (%/yr, model assumption),
// vol = annualized volatility (%), bG/bI = growth/inflation surprise betas
// (score units per σ), carry = annual carry (%/yr).
export const UNIVERSE = [
  { id: 'usEq',  name: 'US Equities',                cls: 'Equity', er: 6.5, vol: 16,  bG: 1.0,  bI: -0.5, carry: 1.5 },
  { id: 'dmEq',  name: 'Global Equities ex-US',      cls: 'Equity', er: 6.8, vol: 17,  bG: 0.9,  bI: -0.4, carry: 2.8 },
  { id: 'emEq',  name: 'EM Equities',                cls: 'Equity', er: 7.8, vol: 21,  bG: 1.1,  bI: -0.2, carry: 3.0 },
  { id: 'ust10', name: 'US 10-Year Treasury',        cls: 'Rates',  er: 4.4, vol: 7,   bG: -0.5, bI: -0.9, carry: 0.4 },
  { id: 'ust30', name: 'US 30-Year Treasury',        cls: 'Rates',  er: 4.8, vol: 13,  bG: -0.7, bI: -1.3, carry: 0.6 },
  { id: 'tips',  name: 'US TIPS (ILB)',              cls: 'Rates',  er: 4.2, vol: 6,   bG: -0.3, bI: 0.8,  carry: 0.2 },
  { id: 'cgb',   name: 'Chinese Government Bonds',   cls: 'Rates',  er: 3.0, vol: 5,   bG: -0.3, bI: -0.4, carry: -0.5 },
  { id: 'igc',   name: 'IG Corporate Credit',        cls: 'Credit', er: 5.2, vol: 8,   bG: 0.4,  bI: -0.5, carry: 1.2 },
  { id: 'emd',   name: 'EM Local-Currency Debt',     cls: 'Credit', er: 6.4, vol: 12,  bG: 0.3,  bI: 0.1,  carry: 3.5 },
  { id: 'gold',  name: 'Gold',                       cls: 'Real',   er: 5.0, vol: 15,  bG: -0.4, bI: 0.9,  carry: -0.2 },
  { id: 'gsci',  name: 'Broad Commodities',          cls: 'Real',   er: 5.5, vol: 16,  bG: 0.6,  bI: 1.2,  carry: 1.0 },
  { id: 'wti',   name: 'Crude Oil',                  cls: 'Real',   er: 5.8, vol: 30,  bG: 0.7,  bI: 1.4,  carry: 4.0 },
  { id: 'cu',    name: 'Copper',                     cls: 'Real',   er: 6.2, vol: 24,  bG: 0.9,  bI: 0.8,  carry: 0.5 },
  { id: 'fxc',   name: 'G10 FX Carry Basket',        cls: 'FX',     er: 4.6, vol: 9,   bG: 0.5,  bI: 0.3,  carry: 4.5 },
  { id: 'cash',  name: 'T-Bills / Cash',             cls: 'Cash',   er: 3.8, vol: 0.6, bG: 0.0,  bI: 0.0,  carry: 0.0 },
]

export const CASH_RATE = 3.8 // %/yr

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

// Rank the universe on the current surprises and split into five tiers of three.
export function rankIntoTiers(g, i) {
  const scored = UNIVERSE.map((a) => ({ ...a, score: scoreAsset(a, g, i) })).sort(
    (x, y) => y.score - x.score,
  )
  return TIER_NAMES.map((t, k) => ({ ...t, assets: scored.slice(k * 3, k * 3 + 3) }))
}
