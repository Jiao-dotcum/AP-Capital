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
