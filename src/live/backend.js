// ————— Backend state client —————
// Reads the canonical machine-state the scheduled ingest persisted server-side.
// Returns null on any failure or before the backend is configured, so callers
// can silently fall back to the simulated / manual-live paths. No API key, no
// button — the compass reads live data the server already fetched.
export async function fetchBackendState() {
  try {
    const res = await fetch('/api/state', { headers: { accept: 'application/json' } })
    if (!res.ok) return null
    const j = await res.json()
    if (!j.configured || !j.reading || j.empty) return null
    return {
      reading: j.reading, // { g, i, source: 'live' }
      hyOasBp: j.hyOasBp,
      prints: j.prints,
      tape: j.tape,
      knownAt: j.knownAt,
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
