import { BENCHMARKS } from '../../src/live/edgar.js'
import { buildRealIssuer, realizedVolAnnual } from '../../src/engine/credit.js'
import { fetchEquityHistory, marketConfigured } from './marketdata.js'

// ————— The real trading desk (Phase 1: Ford, Carnival, Occidental) —————
// Turns already-fetched EDGAR fundamentals (api/_lib/edgar.js — fetched once
// per run, reused here rather than re-pulled, so this never doubles SEC
// traffic) plus live Alpaca equity price history into issuer objects
// screenPerforming can actually trade: KMV-unlever real market cap and
// realized equity vol against the filed debt (buildRealIssuer, one formula,
// one module, in engine/credit.js). A name that fails ANY step — no EDGAR
// row, no price history, KMV non-convergence — is excluded from the traded
// book, not estimated; its reason is returned in `errors` the same way
// edgarIssuerErrors already surfaces EDGAR-side failures.
const EQUITY_LOOKBACK_DAYS = 120

export async function buildRealIssuers(fundamentalsRows, now = new Date()) {
  if (!fundamentalsRows?.length || !marketConfigured()) return { issuers: [], errors: [] }
  const tickers = BENCHMARKS.map((b) => b.ticker)
  const equityHistory = await fetchEquityHistory(tickers, now, EQUITY_LOOKBACK_DAYS)
  const issuers = []
  const errors = []
  for (const meta of BENCHMARKS) {
    const f = fundamentalsRows.find((r) => r.ticker === meta.ticker)
    if (!f || f.error) continue // already surfaced via edgarIssuerErrors — not this module's failure to report
    const eq = equityHistory[meta.ticker]
    if (!eq || eq.closes.length < 20) {
      errors.push(`${meta.ticker}: insufficient live equity price history`)
      continue
    }
    try {
      const equityVolAnnual = realizedVolAnnual(eq.closes)
      const real = buildRealIssuer(meta, f, { price: eq.latestClose, sharesOut: f.sharesOut, equityVolAnnual })
      issuers.push({ ...real, fiscalEnd: f.fiscalEnd ?? null, priceAsOf: eq.asof })
    } catch (err) {
      errors.push(`${meta.ticker}: ${err.message || err}`)
    }
  }
  return { issuers, errors }
}
