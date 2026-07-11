// ————— Backend state client —————
// Reads the canonical machine-state and latest market prices the scheduled
// ingest persisted server-side. Returns null on any failure or before the
// backend is configured, so callers fall back to the simulated / manual-live
// paths. No API key, no button — the compass and the book's marks read data
// the server already fetched. The macro reading and prices are independent:
// either can be present without the other, so both are surfaced whenever set.
export async function fetchBackendState() {
  try {
    const res = await fetch('/api/state', { headers: { accept: 'application/json' } })
    if (!res.ok) return null
    const j = await res.json()
    if (!j.configured) return null
    const hasReading = j.reading && !j.empty
    return {
      reading: hasReading ? j.reading : null, // { g, i, source: 'live' }
      hyOasBp: hasReading ? j.hyOasBp : null,
      prints: hasReading ? j.prints : null,
      tape: hasReading ? j.tape : null,
      knownAt: j.knownAt ?? null,
      prices: j.prices ?? null, // { TICKER: {close, prevClose, change, asof} }
      run: j.run ?? null, // latest canonical engine run: { seq, knownAt, decision, orders, nav, prevHash, hash }
      fundamentals: j.fundamentals ?? null, // latest EDGAR rows per issuer (partial deriveFundamentals shape)
    }
  } catch {
    return null
  }
}

// A short, human "as of" stamp for the status line.
export function asOf(iso) {
  try {
    return new Date(iso).toISOString().replace('T', ' ').slice(0, 16) + ' UTC'
  } catch {
    return String(iso)
  }
}
