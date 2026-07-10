// ————— Sleeve → listed proxy map —————
// Each abstract sleeve in the universe trades through a liquid, listed ETF —
// the same "listed proxies only" discipline the Charter requires. These are
// the tickers the market-data feed prices, and the instruments a real book
// would actually hold. Editable: swap a proxy without touching the engine.
export const PROXIES = {
  usEq: { ticker: 'SPY', name: 'S&P 500' },
  dmEq: { ticker: 'VEA', name: 'Developed ex-US' },
  emEq: { ticker: 'VWO', name: 'Emerging Markets' },
  ust10: { ticker: 'IEF', name: '7–10y Treasury' },
  ust30: { ticker: 'TLT', name: '20+y Treasury' },
  tips: { ticker: 'TIP', name: 'TIPS' },
  cgb: { ticker: 'CBON', name: 'China Bond' },
  igc: { ticker: 'LQD', name: 'IG Corporate' },
  emd: { ticker: 'EMLC', name: 'EM Local-Ccy Debt' },
  gold: { ticker: 'GLD', name: 'Gold' },
  gsci: { ticker: 'DBC', name: 'Broad Commodities' },
  wti: { ticker: 'USO', name: 'Crude Oil' },
  cu: { ticker: 'CPER', name: 'Copper' },
  fxc: { ticker: 'DBV', name: 'G10 FX Carry' },
  arb: { ticker: 'MNA', name: 'Merger Arbitrage' },
  vix: { ticker: 'VIXM', name: 'Mid-Term VIX' },
  cash: { ticker: 'BIL', name: '1–3mo T-Bills' },
}

export const TICKERS = [...new Set(Object.values(PROXIES).map((p) => p.ticker))]
export const proxyOf = (sleeveId) => PROXIES[sleeveId] || null

// Build a sleeveId → daily-return-% map from a ticker-keyed price map, for
// marking the paper book to real closes.
export function sleeveReturns(pricesByTicker) {
  if (!pricesByTicker) return null
  const out = {}
  for (const [id, p] of Object.entries(PROXIES)) {
    const px = pricesByTicker[p.ticker]
    if (px && Number.isFinite(px.change)) out[id] = px.change
  }
  return Object.keys(out).length ? out : null
}
