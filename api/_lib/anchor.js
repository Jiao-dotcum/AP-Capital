// ————— External anchoring: tamper-EVIDENT → tamper-PROOF —————
// The hash chain proves internal consistency, but the database is ours. A
// skeptic can always say the whole history was rewritten last night, and
// nothing inside the system can refute that. Committing the chain's head
// hash to a repository we do NOT control fixes it in time: GitHub stamps
// every commit server-side, and a commit cannot be backdated on someone
// else's server.
//
// What the anchor claims is narrow and deliberate: "this head hash existed
// at this time." It does NOT assert the chain is valid. Validity is proven
// separately by /api/chain, which recomputes every link and which anyone can
// call themselves. Keeping the two apart is the whole point — a single
// endpoint saying "trust me, it's all fine" is self-reported; an external
// timestamp plus an independent recomputation is checkable. Together they
// support the only claim that matters: the record said X on date D, and
// still says X now.

const API = 'https://api.github.com'
const DEFAULT_PATH = 'anchors/chain.jsonl'

// Guarded like every other integration (Invariant 5): unset ⇒ the whole
// feature no-ops and the ingest is otherwise unaffected.
export const anchorConfigured = () => Boolean(process.env.GITHUB_TOKEN && process.env.ANCHOR_REPO)

export const anchorPath = () => process.env.ANCHOR_PATH || DEFAULT_PATH

// ————— Pure transforms (testable without a network) —————

// One anchor line. `head` is the load-bearing field — everything else is
// context for a human reading the log. Kept to one JSON object per line so
// the file is append-only in the literal sense: every commit adds a line and
// changes nothing above it, so `git blame` dates each entry individually.
export const anchorRecord = (head, now = new Date()) => ({
  anchoredAt: now.toISOString(),
  seq: head.seq,
  head: head.hash,
  knownAt: head.knownAt instanceof Date ? head.knownAt.toISOString() : (head.knownAt ?? null),
})

// The most recently anchored head hash, or null for a fresh/absent log.
// Tolerates a trailing newline and ignores an unparseable final line rather
// than throwing — a corrupt last line should cost one duplicate anchor, not
// break the ingest.
export function lastAnchoredHead(text) {
  if (!text) return null
  const lines = text.split('\n').filter((l) => l.trim())
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const head = JSON.parse(lines[i]).head
      if (head) return head
    } catch {
      /* skip a malformed line and keep looking back */
    }
  }
  return null
}

// Append a record to the log text, always newline-terminated so the next
// append can't concatenate onto the previous line.
export const appendAnchorLine = (text, record) =>
  `${text && !text.endsWith('\n') ? `${text}\n` : text || ''}${JSON.stringify(record)}\n`

// ————— GitHub Contents API —————

async function gh(path, init = {}) {
  let res
  try {
    res = await fetch(`${API}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        'user-agent': 'ap-capital-anchor',
        ...(init.headers || {}),
      },
      signal: AbortSignal.timeout(15_000),
    })
  } catch (err) {
    // "fetch failed" says nothing — surface err.cause (see CLAUDE.md).
    const cause = err?.cause ? `: ${err.cause.code || err.cause.message || err.cause}` : ''
    const kind = err?.name === 'TimeoutError' || err?.name === 'AbortError' ? 'timed out (15s)' : 'fetch failed'
    throw new Error(`GitHub ${path} ${kind}${cause}`)
  }
  return res
}

// Current log contents + blob sha (needed to update), or null when the file
// doesn't exist yet — the first anchor creates it.
export async function readAnchorLog() {
  const res = await gh(`/repos/${process.env.ANCHOR_REPO}/contents/${anchorPath()}`)
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`GitHub read ${res.status}`)
  const j = await res.json()
  return { text: Buffer.from(j.content || '', 'base64').toString('utf8'), sha: j.sha }
}

// Anchor the chain head. Idempotent by design: an unchanged head anchors
// nothing, so re-running the ingest doesn't spam commits — the log records
// distinct chain states, mirroring how the chain itself records decisions
// rather than invocations.
export async function anchorChainHead(head, now = new Date()) {
  if (!anchorConfigured()) return { configured: false }
  if (!head?.hash) return { configured: true, anchored: false, reason: 'no chain head to anchor' }

  const existing = await readAnchorLog()
  if (lastAnchoredHead(existing?.text) === head.hash) {
    return { configured: true, anchored: false, reason: 'head unchanged since last anchor', head: head.hash.slice(0, 12) }
  }

  const record = anchorRecord(head, now)
  const body = {
    message: `anchor: chain head seq ${record.seq} ${record.head.slice(0, 12)}`,
    content: Buffer.from(appendAnchorLine(existing?.text ?? '', record), 'utf8').toString('base64'),
    ...(existing?.sha ? { sha: existing.sha } : {}),
  }
  const res = await gh(`/repos/${process.env.ANCHOR_REPO}/contents/${anchorPath()}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  })
  // 409 = someone else committed between our read and write. Harmless: the
  // next run anchors instead. Same linearity property the chain's own unique
  // parent index enforces at the database level.
  if (res.status === 409) return { configured: true, anchored: false, reason: 'concurrent update, will retry next run' }
  if (!res.ok) throw new Error(`GitHub write ${res.status}`)
  const j = await res.json()
  return {
    configured: true,
    anchored: true,
    seq: record.seq,
    head: record.head.slice(0, 12),
    commit: j.commit?.sha?.slice(0, 12) ?? null,
    url: j.content?.html_url ?? null,
  }
}
