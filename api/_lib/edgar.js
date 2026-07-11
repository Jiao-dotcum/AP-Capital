import { BENCHMARKS, deriveFundamentals } from '../../src/live/edgar.js'

// ————— Credit fundamentals ingestion (SEC EDGAR XBRL) —————
// data.sec.gov is free and keyless — the browser only routes it through the
// Anthropic web_fetch tool because SEC sends no CORS headers, a restriction
// that does not exist server-side. What SEC DOES require is a descriptive
// User-Agent identifying the caller (and ~10 req/s max), so this feed is
// gated on SEC_USER_AGENT (e.g. "AP Capital admin@example.com"): unset ⇒
// skipped entirely and the dashboard keeps its offline structural estimates.
// Parsing and the Merton→PD→EL pipeline are the SAME deriveFundamentals the
// browser path uses (one formula, one module) — only the fetch layer differs.

export const secConfigured = () => Boolean(process.env.SEC_USER_AGENT)

const factsUrl = (cik) => `https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`

async function fetchCompanyFacts(cik, userAgent) {
  let res
  try {
    res = await fetch(factsUrl(cik), {
      headers: { 'User-Agent': userAgent, accept: 'application/json' },
      signal: AbortSignal.timeout(20_000),
    })
  } catch (err) {
    const cause = err?.cause ? `: ${err.cause.code || err.cause.message || err.cause}` : ''
    const kind = err?.name === 'TimeoutError' || err?.name === 'AbortError' ? 'timed out (20s)' : 'fetch failed'
    throw new Error(`EDGAR CIK${cik} ${kind}${cause}`)
  }
  if (!res.ok) throw new Error(`EDGAR CIK${cik} HTTP ${res.status}`)
  return res.json()
}

// One row per issuer, independent try/catch each — one bad filing must not
// blank the whole panel. Rows that fail carry { error } and no numbers.
export async function fetchFundamentals(now = new Date(), issuers = BENCHMARKS) {
  if (!secConfigured()) return null
  const userAgent = process.env.SEC_USER_AGENT
  const knownAt = now.toISOString()
  const rows = await Promise.all(
    issuers.map(async (issuer) => {
      try {
        const facts = await fetchCompanyFacts(issuer.cik, userAgent)
        return { ...deriveFundamentals(issuer, facts), knownAt }
      } catch (err) {
        return { ...issuer, error: String(err.message || err), knownAt }
      }
    }),
  )
  if (!rows.some((r) => !r.error)) throw new Error(rows.map((r) => r.error).join(' | '))
  return rows
}
