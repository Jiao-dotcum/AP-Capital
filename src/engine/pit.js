// ————— The point-in-time register —————
// Every live input is stored with two timestamps: the date the observation
// is *for* (obsDate) and the moment it became *knowable* to the machine
// (knownAt — the fetch time). The register is append-only: a revision to a
// prior period is a new record, never an overwrite. Any backtest that reads
// only records with knownAt ≤ T is lookahead-proof by construction.

export const PIT_VERSION = 1

export const emptyPit = () => ({ v: PIT_VERSION, records: [] })

const keyOf = (r) => `${r.series}|${r.obsDate}|${r.value}|${r.source}`

// Append new observations, preserving the earliest knownAt for duplicates.
// Returns a new store; never mutates.
export function pitAppend(store, records) {
  const seen = new Set(store.records.map(keyOf))
  const fresh = records.filter((r) => {
    const k = keyOf(r)
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
  if (fresh.length === 0) return store
  return { ...store, records: [...store.records, ...fresh] }
}

// The latest observation for a series knowable at or before asOf
// (asOf omitted = everything). Ties on obsDate resolve to the latest knownAt
// (most recent revision).
export function pitLatest(store, series, asOf = null) {
  let best = null
  for (const r of store.records) {
    if (r.series !== series) continue
    if (asOf && r.knownAt > asOf) continue
    if (!best || r.obsDate > best.obsDate || (r.obsDate === best.obsDate && r.knownAt > best.knownAt)) {
      best = r
    }
  }
  return best
}

// One row per series for the provenance table: latest record + count.
export function pitSummary(store) {
  const bySeries = new Map()
  for (const r of store.records) {
    const cur = bySeries.get(r.series)
    if (!cur) bySeries.set(r.series, { latest: r, count: 1 })
    else {
      cur.count += 1
      const b = cur.latest
      if (r.obsDate > b.obsDate || (r.obsDate === b.obsDate && r.knownAt > b.knownAt)) cur.latest = r
    }
  }
  return [...bySeries.entries()].map(([series, { latest, count }]) => ({ series, ...latest, count }))
}

export function serializePit(store) {
  return JSON.stringify(store)
}

export function deserializePit(text) {
  try {
    const obj = JSON.parse(text)
    if (obj && obj.v === PIT_VERSION && Array.isArray(obj.records)) return obj
  } catch {
    /* corrupt or missing — start fresh */
  }
  return emptyPit()
}
