import { configured, getChainRuns } from './_lib/db.js'
import { verifyChain } from './_lib/engine.js'

// ————— The audit endpoint —————
// Recomputes every link of the hash chain from the stored payloads and
// reports the head. The chain is tamper-EVIDENT by construction; anchoring
// makes it tamper-PROOF in practice: snapshot this response somewhere the
// database writer can't touch (curl it weekly into a file, an email to
// yourself, a git commit) and any later rewrite of history is provable,
// because a rewritten chain cannot reproduce an anchored head hash.
//
//   GET /api/chain        → { length, head, verified: { ok, brokenAt } }
//   GET /api/chain?full=1 → the same plus every run's sealed payload
export default async function handler(req, res) {
  try {
    if (!configured()) return res.status(200).json({ configured: false })
    const runs = (await getChainRuns()) ?? []
    const head = runs.length ? runs[runs.length - 1] : null
    const out = {
      configured: true,
      length: runs.length,
      head: head ? { seq: head.seq, knownAt: head.knownAt, nav: head.nav, hash: head.hash } : null,
      verified: verifyChain(runs),
    }
    if (req.query?.full === '1') out.runs = runs
    return res.status(200).json(out)
  } catch (err) {
    return res.status(200).json({ configured: false, error: String(err.message || err) })
  }
}
