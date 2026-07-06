// Phase 2 in miniature: the firm's judgment layers (IC debate + the Memo)
// executed by a real model instead of templates. One Messages API call from
// the browser; defensive parsing; callers fall back to the simulated firm.

const buildPrompt = (ctx) => `You are the judgment layers of "The Complete Machine", an autonomous fund
that merges Bridgewater's systematic macro with Oaktree's credit philosophy
(Howard Marks: second-level thinking, cycle positioning, margin of safety).

Current state (all figures simulated or live as marked):
${JSON.stringify(ctx, null, 1)}

Perform two tasks and reply with ONLY a raw JSON object — no prose outside it,
no markdown fences:

1. Investment-committee debate. Three members with fixed priors vote aye/nay
   on the desks' current proposals: "Cassandra" (perma-bear — hates froth,
   respects dry powder), "Quadratus" (macro-first — trusts the regime
   quadrant), "Fossor" (bottom-up-first — trusts consensus divergence).
   One short sentence of reasoning each, in character.

2. The quarterly Memo, in the measured, aphoristic voice of a Howard
   Marks memo: where we stand in the cycle, what the crowd believes and
   where we differ (name specific issuers from the state), and posture.
   Three paragraphs of 60-110 words each, then a one-line sign-off.

Shape: {"votes": [{"name": "Cassandra", "vote": "aye"|"nay", "reason": "..."},
{"name": "Quadratus", ...}, {"name": "Fossor", ...}],
"memo_title": "...", "memo_paragraphs": ["...", "...", "...", "..."]}`

export async function conveneFirm(apiKey, ctx) {
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
      max_tokens: 2048,
      messages: [{ role: 'user', content: buildPrompt(ctx) }],
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
    .replace(/```(?:json)?/gi, '')

  const match = text.match(/\{[\s\S]*\}/)
  if (!match) throw new Error('no JSON object in model reply')
  let obj
  try {
    obj = JSON.parse(match[0])
  } catch {
    throw new Error('model reply was not valid JSON')
  }

  if (!Array.isArray(obj.votes) || obj.votes.length < 3) throw new Error('votes missing')
  const votes = obj.votes.slice(0, 3).map((v) => ({
    name: String(v.name ?? '?'),
    vote: String(v.vote).toLowerCase() === 'aye' ? 'aye' : 'nay',
    reason: String(v.reason ?? '').slice(0, 220),
  }))
  if (typeof obj.memo_title !== 'string' || !Array.isArray(obj.memo_paragraphs)) {
    throw new Error('memo missing')
  }
  const paragraphs = obj.memo_paragraphs.map((p) => String(p)).filter(Boolean).slice(0, 5)
  if (paragraphs.length < 2) throw new Error('memo too short')

  return { votes, title: obj.memo_title.slice(0, 90), paragraphs }
}
