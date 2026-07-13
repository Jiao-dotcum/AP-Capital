import { mertonDtD, pdFromDtD, migrationOf } from '../engine/credit.js'

// ————— Live credit fundamentals: SEC EDGAR XBRL —————
// data.sec.gov sends no CORS headers, so the browser routes one companyfacts
// pull per issuer through the Anthropic web_fetch server tool (same pattern
// as the FRED feed). The raw XBRL JSON is parsed deterministically here — the
// model only fetches the document, it never interprets a number. Coverage and
// leverage come from the filings; distance-to-default, PD, and expected loss
// run through the same structural model as the simulated desk.

// Real, liquid high-yield-ish benchmark issuers. CIKs are public, confirmed
// against SEC EDGAR company search (2026-07-13). `rating` is each issuer's
// approximate current Moody's corporate family rating researched at the
// same date — metadata, not something this pipeline derives or refreshes
// itself, so it WILL go stale between manual updates, same as `recovery`
// (a sector-convention estimate, not filed or market-observed — see
// docs/ENGINE_GUIDE.md §6 for what's still owed here). cov/lev/mult/av are
// offline estimates so the panel and the traded book render before any live
// pull; a successful EDGAR+Alpaca pull (api/_lib/realIssuers.js) overwrites
// cov/lev from the filing and mult/av from KMV-unlevering real market data —
// see buildRealIssuer, engine/credit.js.
export const BENCHMARKS = [
  { ticker: 'F', cik: '0000037996', name: 'Ford Motor', sector: 'Autos', rating: 'Ba1', recovery: 55, mult: 7.5, av: 0.26, cov: 3.4, lev: 4.6 },
  { ticker: 'CCL', cik: '0000815097', name: 'Carnival', sector: 'Lodging & Gaming', rating: 'B1', recovery: 48, mult: 8.4, av: 0.34, cov: 2.5, lev: 5.4 },
  { ticker: 'OXY', cik: '0000797468', name: 'Occidental Petroleum', sector: 'Energy', rating: 'Ba1', recovery: 62, mult: 6.8, av: 0.30, cov: 4.1, lev: 3.3 },
  { ticker: 'AAL', cik: '0000006201', name: 'American Airlines Group', sector: 'Transport', rating: 'B1', recovery: 45, mult: 6.5, av: 0.40, cov: 2.0, lev: 4.8 },
  { ticker: 'CHTR', cik: '0001091667', name: 'Charter Communications', sector: 'Communications', rating: 'Ba2', recovery: 55, mult: 8.0, av: 0.32, cov: 2.8, lev: 4.3 },
  { ticker: 'M', cik: '0000794367', name: "Macy's", sector: 'Retail', rating: 'Ba1', recovery: 40, mult: 6.0, av: 0.42, cov: 3.0, lev: 2.8 },
  { ticker: 'FCX', cik: '0000831259', name: 'Freeport-McMoRan', sector: 'Materials', rating: 'Baa3', recovery: 50, mult: 7.5, av: 0.38, cov: 5.5, lev: 1.6 },
  { ticker: 'CYH', cik: '0001108109', name: 'Community Health Systems', sector: 'Healthcare', rating: 'B3', recovery: 35, mult: 7.0, av: 0.55, cov: 1.3, lev: 6.5 },
]

// Compute the derived row (DtD, PD, EL) from an issuer's cov/lev — used to
// render the panel offline from the structural estimates above.
export function staticFundamentals(issuer) {
  const dd = mertonDtD(issuer, 1)
  const pd = pdFromDtD(dd)
  const lgd = 1 - issuer.recovery / 100
  const mig = migrationOf(issuer.rating)
  return {
    ...issuer,
    dd: +dd.toFixed(1),
    pd,
    el: +(pd * lgd * 100).toFixed(2),
    elSpread: Math.round(pd * lgd * 1e4),
    pDefault1y: mig.pDefault,
    source: 'estimate',
  }
}

export const staticBenchmarks = () => BENCHMARKS.map(staticFundamentals)

// Rows the backend ingest stored (cov/lev straight from the filings) folded
// back onto the benchmark issuers through the SAME structural pipeline —
// issuers without a stored row keep their offline estimate.
export function mergeBackendFundamentals(stored) {
  const byTicker = Object.fromEntries((stored ?? []).map((r) => [r.ticker, r]))
  return BENCHMARKS.map((issuer) => {
    const live = byTicker[issuer.ticker]
    if (!live || !Number.isFinite(live.cov) || !Number.isFinite(live.lev)) return staticFundamentals(issuer)
    return { ...staticFundamentals({ ...issuer, cov: live.cov, lev: live.lev }), source: 'EDGAR' }
  })
}

const factsUrl = (cik) => `https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`

export async function fetchEdgarFundamentals(apiKey, issuers = BENCHMARKS) {
  if (!apiKey) throw new Error('no API key provided')
  const out = []
  for (const issuer of issuers) {
    try {
      const json = await fetchCompanyFacts(apiKey, issuer.cik)
      out.push(deriveFundamentals(issuer, json))
    } catch (err) {
      out.push({ ...issuer, error: err.message })
    }
  }
  if (!out.some((r) => !r.error)) throw new Error('no issuer facts retrieved')
  return out
}

async function fetchCompanyFacts(apiKey, cik) {
  const url = factsUrl(cik)
  const request = (messages) =>
    fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: 'claude-opus-4-8',
        max_tokens: 512,
        tools: [
          {
            type: 'web_fetch_20260209',
            name: 'web_fetch',
            max_uses: 2,
            allowed_domains: ['data.sec.gov'],
            max_content_tokens: 60000,
          },
        ],
        messages,
      }),
    })

  const userTurn = { role: 'user', content: `Fetch this exact URL with web_fetch and reply only DONE: ${url}` }
  let res = await request([userTurn])
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  let data = await res.json()
  if (data.stop_reason === 'pause_turn') {
    res = await request([userTurn, { role: 'assistant', content: data.content }])
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    data = await res.json()
  }
  const json = findFactsJson(data.content)
  if (!json) throw new Error('no companyfacts JSON in result')
  return json
}

// Structurally search the response for the companyfacts document and parse it.
export function findFactsJson(content) {
  const stack = [content]
  while (stack.length) {
    const node = stack.pop()
    if (typeof node === 'string') {
      if (node.includes('us-gaap') && node.includes('"facts"')) {
        try {
          const start = node.indexOf('{')
          return JSON.parse(node.slice(start))
        } catch {
          /* keep searching */
        }
      }
    } else if (Array.isArray(node)) {
      stack.push(...node)
    } else if (node && typeof node === 'object') {
      if (node.facts && node.facts['us-gaap']) return node
      stack.push(...Object.values(node))
    }
  }
  return null
}

// The latest annual (FY, form 10-K) USD observation for a us-gaap concept,
// trying each candidate tag in order until one has data. Returns the full
// observation so callers can carry the fiscal period end (PIT discipline:
// obsDate = what period the number is FOR, knownAt = when we learned it).
export function latestAnnualObs(facts, concepts) {
  for (const concept of concepts) {
    const node = facts?.facts?.['us-gaap']?.[concept]
    if (!node) continue
    const units = node.units?.USD
    if (!units) continue
    const annual = units
      .filter((u) => u.form === '10-K' && u.fp === 'FY' && Number.isFinite(u.val))
      .sort((a, b) => (a.end < b.end ? 1 : -1))
    if (annual.length) return annual[0]
  }
  return null
}

export const latestAnnual = (facts, concepts) => latestAnnualObs(facts, concepts)?.val ?? null

// Coverage = operating income / interest expense; leverage = total debt /
// EBITDA-proxy (operating income + D&A, falling back to operating income).
// Then the same Merton → PD → expected-loss pipeline as the simulated desk.
export function deriveFundamentals(issuer, facts) {
  let opIncObs = latestAnnualObs(facts, ['OperatingIncomeLoss'])
  // Confirmed in production (2026-07-13, Occidental — SEC returned NoSuchKey
  // for this exact CIK+concept): companies using a single-step income
  // statement never present a distinct "operating income" subtotal at all,
  // so the tag doesn't exist to fetch, not just to fall back from. Derive
  // the same economic quantity safely — revenue and total costs/expenses
  // are both conventionally positive with no sign ambiguity, unlike a net-
  // interest fallback (deliberately not added; see below).
  if (!opIncObs) {
    const revObs = latestAnnualObs(facts, ['Revenues', 'RevenueFromContractWithCustomerExcludingAssessedTax'])
    const costObs = latestAnnualObs(facts, ['CostsAndExpenses'])
    if (revObs && costObs && revObs.end === costObs.end) {
      opIncObs = { val: revObs.val - costObs.val, end: revObs.end }
    }
  }
  const opInc = opIncObs?.val ?? null
  const interest = latestAnnual(facts, ['InterestExpense', 'InterestExpenseDebt', 'InterestAndDebtExpense'])
  // LongTermDebtAndCapitalLeaseObligations added as a same-meaning fallback
  // (Occidental hit "required XBRL facts missing" in production, 2026-07-13
  // — not yet root-caused to a specific field without live XBRL access).
  const debt = latestAnnual(facts, [
    'LongTermDebtNoncurrent',
    'LongTermDebt',
    'DebtLongtermAndShorttermCombinedAmount',
    'LongTermDebtAndCapitalLeaseObligations',
    'Liabilities',
  ])
  const da = latestAnnual(facts, ['DepreciationDepletionAndAmortization', 'DepreciationAmortizationAndAccretionNet', 'DepreciationAndAmortization']) || 0
  if (!Number.isFinite(opInc) || !Number.isFinite(interest) || !Number.isFinite(debt) || interest <= 0) {
    throw new Error('required XBRL facts missing')
  }
  const ebitda = opInc + da
  const cov = +(opInc / interest).toFixed(1)
  const rawLev = ebitda > 0 ? debt / ebitda : Infinity
  // Confirmed in production (2026-07-13, Ford Motor): one of the debt
  // fallback tags returned a partial balance (a single tranche, not total
  // debt), so lev rounded to 0.0x. mertonDtD divides mult/lev, so a
  // near-zero lev sends V/D — and DtD — to Infinity, silently producing a
  // PD of 0.01% and an expected loss of 0bp for a real leveraged issuer.
  // Fail loud instead of feeding the model a denominator near zero; a
  // High-yield-ish benchmark issuer with lev < 0.3x is a data error, not
  // a real signal, until a specific mistagged concept is identified.
  if (Number.isFinite(rawLev) && rawLev < 0.3) {
    throw new Error(`implausible leverage (${rawLev.toFixed(2)}x) — debt tag likely partial`)
  }
  const lev = ebitda > 0 ? +rawLev.toFixed(1) : 99
  const model = { ...issuer, cov, lev }
  const dd = mertonDtD(model, 1)
  const pd = pdFromDtD(dd)
  const lgd = 1 - issuer.recovery / 100
  const mig = migrationOf(issuer.rating)
  // Shares outstanding — the one extra fact the real trading desk needs
  // beyond this benchmark panel's own display: market cap = price × shares,
  // and market cap is what the KMV unlevering in engine/credit.js needs to
  // turn a real equity price into a real equity VALUE (see
  // buildRealIssuer / api/_lib/realIssuers.js). Harmless to compute here
  // even when nothing downstream uses it yet.
  const sharesOut = latestAnnual(facts, ['CommonStockSharesOutstanding', 'CommonStockSharesIssued'])
  return {
    ...issuer,
    cov,
    lev,
    ebitda,
    debt,
    sharesOut,
    fiscalEnd: opIncObs.end ?? null, // the FY these facts are FOR (PIT obsDate)
    dd: +dd.toFixed(1),
    pd,
    el: +(pd * lgd * 100).toFixed(2),
    elSpread: Math.round(pd * lgd * 1e4),
    pDefault1y: mig.pDefault,
    source: 'EDGAR',
  }
}
