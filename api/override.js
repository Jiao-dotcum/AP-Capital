import { configured, ensureSchema, insertDialOverride, getLatestDialOverride } from './_lib/db.js'

// ————— Human ratification of the dial (The Charter) —————
// The Charter requires that the dial override — a human choosing the firm's
// aggressiveness — survives every layer of automation. The browser override
// only affects that one tab; THIS is the override the canonical engine run
// obeys. Append-only: every ratification and every resume-auto is its own
// row, and the run it applies to records it inside the hash-chained decision.
//
//   GET  /api/override                      → the standing override (or null)
//   POST /api/override {"dial": 62, "note"} → pin the dial (0–100)
//   POST /api/override {"dial": null}       → resume automatic
//
// POST requires the CRON_SECRET bearer token — only the owner ratifies.
export default async function handler(req, res) {
  if (!configured()) return res.status(200).json({ configured: false })
  await ensureSchema()

  if (req.method === 'GET') {
    const current = await getLatestDialOverride()
    return res.status(200).json({ configured: true, override: current })
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'GET or POST' })
  const secret = process.env.CRON_SECRET
  if (!secret) return res.status(403).json({ error: 'set CRON_SECRET before using the override' })
  if (req.headers.authorization !== `Bearer ${secret}`) return res.status(401).json({ error: 'unauthorized' })

  const { dial, note } = req.body ?? {}
  if (dial !== null && !(Number.isInteger(dial) && dial >= 0 && dial <= 100)) {
    return res.status(400).json({ error: 'dial must be an integer 0–100, or null to resume automatic' })
  }
  await insertDialOverride(dial, note)
  return res.status(200).json({
    configured: true,
    override: { dial, note: note ?? null },
    appliesFrom: 'the next canonical engine run',
  })
}
