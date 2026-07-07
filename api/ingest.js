import { fetchFredState } from './_lib/ingest.js'
import { configured, ensureSchema, insertObservations, saveState } from './_lib/db.js'

// ————— Scheduled ingestion (Vercel Cron → this endpoint) —————
// Pulls the FRED series directly (keyless CSV, no LLM), stores the raw
// observations point-in-time, and appends one machine-state snapshot the
// dashboard can read. Runs on the schedule in vercel.json; can also be hit
// manually to backfill "now".
export default async function handler(req, res) {
  // If a CRON_SECRET is configured, require it (Vercel Cron sends it as a
  // Bearer token). Before it is set, the endpoint is open — set it before go-live.
  const secret = process.env.CRON_SECRET
  if (secret && req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ error: 'unauthorized' })
  }

  try {
    const state = await fetchFredState()
    let stored = 0
    if (configured()) {
      await ensureSchema()
      stored = await insertObservations(state.records)
      await saveState(state)
    }
    return res.status(200).json({
      ok: true,
      configured: configured(),
      knownAt: state.knownAt,
      observationsStored: stored,
      prints: state.prints,
    })
  } catch (err) {
    return res.status(502).json({ ok: false, error: String(err.message || err) })
  }
}
