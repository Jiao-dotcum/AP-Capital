import { PRICED_IN, SIGMA_MAX } from '../engine/machine.js'
import { clamp } from '../engine/prng.js'

const PROMPT = `Search the web for the most recent official US macro and credit prints and reply with ONLY a raw JSON object — no prose, no markdown fences — of this exact shape:
{"gdp_saar": <latest US real GDP quarter-over-quarter SAAR growth, percent, number>, "core_cpi_yoy": <latest US core CPI year-over-year, percent, number>, "policy_rate": <current federal funds target midpoint, percent, number>, "hy_oas": <latest ICE BofA US High Yield Index option-adjusted spread, in basis points, number>}`

// Calls the Anthropic Messages API directly from the browser with the
// web-search server tool. Throws on any failure; the caller falls back
// to simulation and surfaces the reason in the status line.
export async function fetchLiveMacro(apiKey) {
  if (!apiKey) throw new Error('no API key provided')

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: 'claude-opus-4-8',
      max_tokens: 1024,
      tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 3 }],
      messages: [{ role: 'user', content: PROMPT }],
    }),
  })
  if (!res.ok) {
    let detail = `HTTP ${res.status}`
    try {
      const err = await res.json()
      if (err?.error?.message) detail = `${detail}: ${err.error.message}`
    } catch {
      /* body not JSON */
    }
    throw new Error(detail)
  }

  const data = await res.json()
  if (data.stop_reason === 'refusal') throw new Error('request was refused')
  const text = (data.content ?? [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n')

  const prints = parsePrints(text)
  return {
    prints,
    reading: {
      g: round2(clamp((prints.gdp_saar - PRICED_IN.gdpSaar) / PRICED_IN.gdpSigma, -SIGMA_MAX, SIGMA_MAX)),
      i: round2(clamp((prints.core_cpi_yoy - PRICED_IN.coreCpiYoY) / PRICED_IN.cpiSigma, -SIGMA_MAX, SIGMA_MAX)),
      source: 'live',
    },
  }
}

// Defensive parse: strip code fences, regex out the first JSON object,
// validate every field is a plausible number.
export function parsePrints(text) {
  const stripped = String(text).replace(/```(?:json)?/gi, '')
  const match = stripped.match(/\{[\s\S]*?\}/)
  if (!match) throw new Error('no JSON object found in model reply')
  let obj
  try {
    obj = JSON.parse(match[0])
  } catch {
    throw new Error('model reply was not valid JSON')
  }
  const fields = [
    ['gdp_saar', -10, 15],
    ['core_cpi_yoy', -2, 15],
    ['policy_rate', 0, 15],
    ['hy_oas', 100, 2500],
  ]
  for (const [key, lo, hi] of fields) {
    const v = Number(obj[key])
    if (!Number.isFinite(v) || v < lo || v > hi) {
      throw new Error(`field "${key}" missing or implausible`)
    }
    obj[key] = v
  }
  return obj
}

const round2 = (x) => +x.toFixed(2)
