import { configured, getLatestState } from './_lib/db.js'

// ————— The read endpoint —————
// The dashboard calls this on load. Before the database is provisioned it
// returns { configured: false } and the client silently falls back to its
// existing simulated / manual-live paths — nothing breaks.
export default async function handler(req, res) {
  try {
    if (!configured()) return res.status(200).json({ configured: false })
    const state = await getLatestState()
    // Cache at the edge for a minute — the ingest runs at most daily.
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=600')
    return res.status(200).json({ configured: true, ...(state || { empty: true }) })
  } catch (err) {
    return res.status(200).json({ configured: false, error: String(err.message || err) })
  }
}
