import { fetchFredState } from './_lib/ingest.js'
import { marketConfigured, fetchPrices } from './_lib/marketdata.js'
import { configured, ensureSchema, insertObservations, saveState, insertPrices } from './_lib/db.js'

// ————— Scheduled ingestion (Vercel Cron → this endpoint) —————
// Pulls FRED (macro, keyless CSV) and, if configured, Alpaca (real closes for
// the listed proxies) — independently, so one source failing doesn't block the
// other. Stores everything point-in-time and appends one machine-state
// snapshot. Runs on the schedule in vercel.json; can also be hit manually.
export default async function handler(req, res) {
  // If a CRON_SECRET is configured, require it (Vercel Cron sends it as a
  // Bearer token). Before it is set, the endpoint is open — set it before go-live.
  const secret = process.env.CRON_SECRET
  if (secret && req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ error: 'unauthorized' })
  }

  const out = { ok: true, configured: configured(), marketConfigured: marketConfigured() }
  if (configured()) await ensureSchema()

  // Macro (FRED)
  try {
    const state = await fetchFredState()
    out.knownAt = state.knownAt
    out.prints = state.prints
    if (configured()) {
      out.observationsStored = await insertObservations(state.records)
      await saveState(state)
    }
  } catch (err) {
    out.ok = false
    out.fredError = String(err.message || err)
  }

  // Market prices (Alpaca) — independent of the macro fetch above.
  if (marketConfigured()) {
    try {
      const prices = await fetchPrices()
      out.tickersFetched = Object.keys(prices).length
      if (configured()) out.pricesStored = await insertPrices(prices)
    } catch (err) {
      out.ok = false
      out.marketError = String(err.message || err)
    }
  }

  return res.status(out.ok ? 200 : 502).json(out)
}
