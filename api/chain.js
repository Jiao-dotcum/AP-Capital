import { configured, getChainRuns } from './_lib/db.js'
import { verifyChain } from './_lib/engine.js'
import { anchorConfigured, anchorPath } from './_lib/anchor.js'

// ————— The audit endpoint —————
// Recomputes every link of the hash chain from the stored payloads and
// reports the head. The chain is tamper-EVIDENT by construction; the daily
// external anchor (api/_lib/anchor.js) makes it tamper-PROOF in practice by
// committing the head hash to a repository the database writer does not
// control, where a third party timestamps it.
//
// How a skeptic checks this without trusting us at all:
//   1. GET /api/chain — recomputes every link here and reports the head.
//   2. Open the anchor log; find the entry for the date in question.
//   3. Compare. A rewritten history cannot reproduce a head hash that was
//      already committed to someone else's server on an earlier date.
// Step 1 proves internal consistency; step 2 proves the record is old. The
// endpoint deliberately reports where the anchor lives rather than asserting
// the anchor agrees — a self-reported "verified: true" would prove nothing.
//
//   GET /api/chain        → { length, head, verified: { ok, brokenAt }, anchor }
//   GET /api/chain?full=1 → the same plus every run's sealed payload
export default async function handler(req, res) {
  try {
    if (!configured()) return res.status(200).json({ configured: false })
    const runs = (await getChainRuns()) ?? []
    const head = runs.length ? runs[runs.length - 1] : null
    const repo = process.env.ANCHOR_REPO
    const out = {
      configured: true,
      length: runs.length,
      head: head ? { seq: head.seq, knownAt: head.knownAt, nav: head.nav, hash: head.hash } : null,
      verified: verifyChain(runs),
      // Where to independently check this head's age. Not a claim that the
      // anchor matches — go look.
      anchor: anchorConfigured()
        ? { configured: true, repo, path: anchorPath(), url: `https://github.com/${repo}/blob/HEAD/${anchorPath()}`, history: `https://github.com/${repo}/commits/HEAD/${anchorPath()}` }
        : { configured: false },
    }
    if (req.query?.full === '1') out.runs = runs
    return res.status(200).json(out)
  } catch (err) {
    return res.status(200).json({ configured: false, error: String(err.message || err) })
  }
}
