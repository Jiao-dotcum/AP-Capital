import { fredCsvUrl, interpretFredCsv, FRED_SERIES, LOOKBACK_DAYS } from '../../src/live/fred.js'

// ————— Pure ingestion transform —————
// Two fetch strategies, one interpreter. `fredgraph.csv` is FRED's keyless
// interactive-chart backend — zero config, but two independent infra fixes
// (error surfacing, IPv4-first DNS) left an identical 20s timeout from this
// deployment, which is the signature of a WAF/anti-bot silent drop on
// datacenter IP ranges rather than a networking fault. `api.stlouisfed.org`
// is FRED's actual documented, key-authenticated developer API — built for
// exactly this kind of automated access and unlikely to carry the same
// protection. Preferred when FRED_API_KEY is set; the keyless scrape remains
// the zero-config fallback. Both paths converge on the SAME interpreter
// (`interpretFredCsv`, reused verbatim from the client) — one formula, one
// module — by synthesizing the API responses into the identical CSV shape.

export function fredCsvToState(csvText, knownAt) {
  const { reading, tape, hyOasBp, prints, records } = interpretFredCsv(csvText, knownAt)
  return { knownAt, reading, tape, hyOasBp, prints, records }
}

export const fredApiKeyConfigured = () => Boolean(process.env.FRED_API_KEY)

// Merge N per-series FRED API observation arrays into one wide CSV, in the
// exact shape parseFredCsv() (src/live/fred.js) already expects: a header of
// `observation_date,<series...>` and one row per date the union of series
// has data for. Pure — testable against a fixture with no network.
export function seriesJsonToCsv(seriesData, seriesIds) {
  const perSeries = {}
  const allDates = new Set()
  for (const id of seriesIds) {
    const m = new Map()
    for (const o of seriesData[id]?.observations ?? []) {
      if (o.value === '.' || o.value == null) continue
      m.set(o.date, o.value)
      allDates.add(o.date)
    }
    perSeries[id] = m
  }
  const dates = [...allDates].sort()
  const lines = [`observation_date,${seriesIds.join(',')}`]
  for (const d of dates) lines.push([d, ...seriesIds.map((id) => perSeries[id].get(d) ?? '')].join(','))
  return lines.join('\n')
}

async function fetchOneSeries(seriesId, apiKey, observationStart) {
  const url =
    `https://api.stlouisfed.org/fred/series/observations?series_id=${seriesId}` +
    `&api_key=${apiKey}&file_type=json&observation_start=${observationStart}&sort_order=asc`
  let res
  try {
    res = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(20_000) })
  } catch (err) {
    const cause = err?.cause ? `: ${err.cause.code || err.cause.message || err.cause}` : ''
    const kind = err?.name === 'TimeoutError' || err?.name === 'AbortError' ? 'timed out (20s)' : 'fetch failed'
    throw new Error(`FRED API ${seriesId} ${kind}${cause}`)
  }
  if (!res.ok) throw new Error(`FRED API ${seriesId} HTTP ${res.status}`)
  return res.json()
}

export async function fetchFredViaApi(now, apiKey) {
  const knownAt = now.toISOString()
  const observationStart = new Date(now.getTime() - LOOKBACK_DAYS * 864e5).toISOString().slice(0, 10)
  const ids = Object.keys(FRED_SERIES)
  const responses = await Promise.all(ids.map((id) => fetchOneSeries(id, apiKey, observationStart)))
  const seriesData = Object.fromEntries(ids.map((id, k) => [id, responses[k]]))
  const csv = seriesJsonToCsv(seriesData, ids)
  return fredCsvToState(csv, knownAt)
}

export async function fetchFredViaCsv(now) {
  const knownAt = now.toISOString()
  let res
  try {
    res = await fetch(fredCsvUrl(now), {
      headers: {
        'User-Agent': 'the-complete-machine/1.0 (fund diagnostic)',
        accept: 'text/csv,text/plain,*/*',
      },
      // A generic 10s serverless timeout can produce an opaque "fetch failed";
      // fail explicitly at 20s instead so the cause is legible.
      signal: AbortSignal.timeout(20_000),
    })
  } catch (err) {
    // Node/undici network failures wrap the real reason in `.cause` (DNS,
    // TLS, connection-refused, or the abort above) and drop it from
    // `.message` — surface it so the ingest response is diagnostic, not just
    // "fetch failed".
    const cause = err?.cause ? `: ${err.cause.code || err.cause.message || err.cause}` : ''
    const kind = err?.name === 'TimeoutError' || err?.name === 'AbortError' ? 'FRED fetch timed out (20s)' : 'FRED fetch failed'
    throw new Error(`${kind}${cause}`)
  }
  if (!res.ok) throw new Error(`FRED HTTP ${res.status}`)
  const csv = await res.text()
  return fredCsvToState(csv, knownAt)
}

export async function fetchFredState(now = new Date()) {
  if (fredApiKeyConfigured()) return fetchFredViaApi(now, process.env.FRED_API_KEY)
  return fetchFredViaCsv(now)
}
