import { PRICED_IN, SIGMA_MAX } from '../engine/machine.js'
import { clamp } from '../engine/prng.js'

// ————— Point-in-time FRED feed —————
// FRED's endpoints send no CORS headers, so a browser-only app cannot call
// them directly. Instead the browser calls the Anthropic Messages API (which
// does allow direct browser access) with the web_fetch server tool and asks
// it to retrieve one exact fredgraph.csv URL. The raw CSV comes back inside
// the web_fetch_tool_result block and is parsed deterministically here — the
// model never paraphrases a number.

export const FRED_SERIES = {
  GDPNOW: { label: 'Real GDP Nowcast (Atlanta Fed GDPNow)', unit: '% SAAR' },
  CPIAUCSL: { label: 'CPI, All Items (index)', unit: 'index' },
  EXPINF1YR: { label: '1y Expected Inflation (Cleveland Fed)', unit: '%' },
  DGS1: { label: '1y Treasury Constant Maturity', unit: '%' },
  DFF: { label: 'Effective Federal Funds Rate', unit: '%' },
  BAMLH0A0HYM2: { label: 'ICE BofA US High Yield OAS', unit: '%' },
}

export const LOOKBACK_DAYS = 430 // 13+ months of CPI for the YoY base, with margin

export function fredCsvUrl(now = new Date()) {
  const cosd = new Date(now.getTime() - LOOKBACK_DAYS * 864e5).toISOString().slice(0, 10)
  return `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${Object.keys(FRED_SERIES).join(',')}&cosd=${cosd}`
}

export async function fetchFredMacro(apiKey) {
  if (!apiKey) throw new Error('no API key provided')
  const url = fredCsvUrl()

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
            allowed_domains: ['fred.stlouisfed.org'],
            max_content_tokens: 30000,
          },
        ],
        messages,
      }),
    })

  const userTurn = {
    role: 'user',
    content: `Fetch this exact URL with the web_fetch tool, then reply with the single word DONE: ${url}`,
  }
  let res = await request([userTurn])
  if (!res.ok) throw new Error(await httpDetail(res))
  let data = await res.json()
  if (data.stop_reason === 'refusal') throw new Error('request was refused')

  // The server tool loop can pause; one continuation resumes it.
  if (data.stop_reason === 'pause_turn') {
    res = await request([userTurn, { role: 'assistant', content: data.content }])
    if (!res.ok) throw new Error(await httpDetail(res))
    data = await res.json()
  }

  const csv = findFredCsv(data.content)
  if (!csv) throw new Error('no FRED CSV in web_fetch result')
  return interpretFredCsv(csv, new Date().toISOString())
}

async function httpDetail(res) {
  let detail = `HTTP ${res.status}`
  try {
    const err = await res.json()
    if (err?.error?.message) detail = `${detail}: ${err.error.message}`
  } catch {
    /* body not JSON */
  }
  return detail
}

// Walk the response content for any string that looks like the fredgraph CSV.
// The block layout is versioned server-side, so search structurally rather
// than assuming an exact path.
export function findFredCsv(content) {
  const stack = [content]
  while (stack.length) {
    const node = stack.pop()
    if (typeof node === 'string') {
      if (looksLikeFredCsv(node)) return node
    } else if (Array.isArray(node)) {
      stack.push(...node)
    } else if (node && typeof node === 'object') {
      stack.push(...Object.values(node))
    }
  }
  return null
}

const looksLikeFredCsv = (s) =>
  /^(observation_date|DATE),/im.test(s) && s.includes('BAMLH0A0HYM2')

// CSV → per-series [{date, value}], missing cells ('.') skipped.
export function parseFredCsv(text) {
  const lines = text.trim().split(/\r?\n/)
  const header = lines[0].split(',').map((h) => h.trim().replace(/^"|"$/g, ''))
  const series = {}
  for (const id of header.slice(1)) series[id] = []
  for (let k = 1; k < lines.length; k++) {
    const cells = lines[k].split(',')
    const date = cells[0]?.trim()
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue
    for (let c = 1; c < header.length; c++) {
      const raw = cells[c]?.trim()
      if (!raw || raw === '.') continue
      const v = Number(raw)
      if (Number.isFinite(v)) series[header[c]].push({ date, value: v })
    }
  }
  return series
}

const last = (arr) => (arr && arr.length ? arr[arr.length - 1] : null)

// Observation closest to `days` before the reference date.
function nearest(arr, refDate, days) {
  const target = new Date(refDate).getTime() - days * 864e5
  let best = null
  let bestGap = Infinity
  for (const o of arr) {
    const gap = Math.abs(new Date(o.date).getTime() - target)
    if (gap < bestGap) {
      bestGap = gap
      best = o
    }
  }
  return best
}

const plausible = (v, lo, hi, name) => {
  if (!Number.isFinite(v) || v < lo || v > hi) throw new Error(`${name} implausible (${v})`)
  return v
}

// Turn the parsed series into the machine's inputs: a surprise reading,
// a real-print tape, cycle anchor, and point-in-time records.
export function interpretFredCsv(text, knownAt) {
  const s = parseFredCsv(text)
  const gdpNow = last(s.GDPNOW)
  const cpi = last(s.CPIAUCSL)
  const expInf = last(s.EXPINF1YR)
  const dgs1 = last(s.DGS1)
  const dff = last(s.DFF)
  const hy = last(s.BAMLH0A0HYM2)
  for (const [name, o] of Object.entries({ GDPNOW: gdpNow, CPIAUCSL: cpi, EXPINF1YR: expInf, DGS1: dgs1, DFF: dff, BAMLH0A0HYM2: hy })) {
    if (!o) throw new Error(`series ${name} missing from CSV`)
  }
  const cpiBase = nearest(s.CPIAUCSL, cpi.date, 365)
  if (!cpiBase || cpiBase.date === cpi.date) throw new Error('no year-ago CPI base observation')

  const cpiYoY = plausible(round2((cpi.value / cpiBase.value - 1) * 100), -5, 20, 'CPI YoY')
  const gdp = plausible(gdpNow.value, -12, 15, 'GDPNow')
  const infExp = plausible(expInf.value, -2, 12, '1y expected inflation')
  const y1 = plausible(dgs1.value, 0, 15, 'DGS1')
  const ff = plausible(dff.value, 0, 15, 'DFF')
  const hyOasBp = Math.round(plausible(hy.value, 1, 25, 'HY OAS') * 100) // FRED quotes percent

  // Actual vs market: inflation against the Cleveland Fed 1y expectation,
  // policy against the 1y-Treasury-implied path; growth priced-in has no free
  // market instrument, so the documented consensus constant stands.
  const g = round2(clamp((gdp - PRICED_IN.gdpSaar) / PRICED_IN.gdpSigma, -SIGMA_MAX, SIGMA_MAX))
  const i = round2(clamp((cpiYoY - infExp) / PRICED_IN.cpiSigma, -SIGMA_MAX, SIGMA_MAX))
  const pol = round2(clamp((ff - y1) / 0.25, -SIGMA_MAX, SIGMA_MAX))

  const tape = [
    { name: 'Real GDP Nowcast (GDPNow)', period: quarterOf(gdpNow.date), priced: PRICED_IN.gdpSaar, actual: gdp, sigma: g, pricedFrom: 'consensus constant' },
    { name: 'CPI, YoY (headline)', period: monthOf(cpi.date), priced: infExp, actual: cpiYoY, sigma: i, pricedFrom: '1y expected inflation' },
    { name: 'Policy Rate, Effective', period: monthOf(dff.date), priced: y1, actual: ff, sigma: pol, pricedFrom: '1y Treasury path' },
  ]

  const records = [
    record('GDPNOW', gdpNow, knownAt),
    record('CPIAUCSL', cpi, knownAt),
    record('CPIAUCSL', cpiBase, knownAt),
    record('EXPINF1YR', expInf, knownAt),
    record('DGS1', dgs1, knownAt),
    record('DFF', dff, knownAt),
    record('BAMLH0A0HYM2', hy, knownAt),
  ]

  return {
    reading: { g, i, source: 'live' },
    tape,
    hyOasBp,
    prints: { gdp_now: gdp, cpi_yoy: cpiYoY, expinf_1y: infExp, dgs1: y1, dff: ff, hy_oas: hyOasBp },
    records,
  }
}

const record = (series, obs, knownAt) => ({
  series,
  label: FRED_SERIES[series].label,
  unit: FRED_SERIES[series].unit,
  value: obs.value,
  obsDate: obs.date,
  knownAt,
  source: 'FRED',
})

const quarterOf = (d) => `Q${Math.floor(+d.slice(5, 7) / 3.01) + 1} ${d.slice(0, 4)}`
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const monthOf = (d) => `${MONTHS[+d.slice(5, 7) - 1]} ${d.slice(0, 4)}`
const round2 = (x) => +x.toFixed(2)
