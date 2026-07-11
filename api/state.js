import { configured, getLatestState, getLatestPrices, getLatestRunSummary, getLatestFundamentals } from './_lib/db.js'

// ————— The read endpoint —————
// The dashboard calls this on load. Before the database is provisioned it
// returns { configured: false } and the client silently falls back to its
// existing simulated / manual-live paths — nothing breaks. `prices` is
// included when the market-data feed has ever stored a tick; absent otherwise
// so the client falls back to factor-modeled marks. `run` is the latest
// canonical engine run (decision + NAV + hash seal), absent until Phase 2's
// first chained run lands.
export default async function handler(req, res) {
  try {
    if (!configured()) return res.status(200).json({ configured: false })
    const [state, prices, run, fundamentals] = await Promise.all([
      getLatestState(),
      getLatestPrices(),
      getLatestRunSummary(),
      getLatestFundamentals(),
    ])
    // Cache at the edge for a minute — the ingest runs at most daily.
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=600')
    return res.status(200).json({
      configured: true,
      ...(state || { empty: true }),
      prices: prices ?? undefined,
      run: run ?? undefined,
      fundamentals: fundamentals ?? undefined,
    })
  } catch (err) {
    return res.status(200).json({ configured: false, error: String(err.message || err) })
  }
}
