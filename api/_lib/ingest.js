import { fredCsvUrl, interpretFredCsv } from '../../src/live/fred.js'

// ————— Pure ingestion transform —————
// The server has no CORS restriction, so it fetches FRED's keyless
// fredgraph.csv directly and runs the SAME deterministic parser the browser
// uses — no LLM in the fetch loop, no FRED API key. Kept as one small pure
// function (`fredCsvToState`) plus a thin network wrapper, so the transform is
// unit-testable against a fixture.

export function fredCsvToState(csvText, knownAt) {
  // interpretFredCsv parses the CSV, converts actual-vs-market surprises, and
  // emits point-in-time observation records. Reused verbatim from the client.
  const { reading, tape, hyOasBp, prints, records } = interpretFredCsv(csvText, knownAt)
  return { knownAt, reading, tape, hyOasBp, prints, records }
}

export async function fetchFredState(now = new Date()) {
  const knownAt = now.toISOString()
  const res = await fetch(fredCsvUrl(now), {
    headers: { 'User-Agent': 'the-complete-machine/1.0 (fund diagnostic)' },
  })
  if (!res.ok) throw new Error(`FRED HTTP ${res.status}`)
  const csv = await res.text()
  return fredCsvToState(csv, knownAt)
}
