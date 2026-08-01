import { configured, getChainRuns } from './_lib/db.js'

// ————— The daily journal —————
// Every canonical run as a journal entry, newest first: the day's P&L
// (attributed per asset), every transaction with the reason it was made,
// and the sealed risk statement (capital per asset, tail numbers, which
// standing rule binds). All of it verbatim from the hash-chained records —
// the journal IS the audit trail, not a report generated from it.
//
// Each entry also carries the control arm (`shadow`): the same Core strategy
// run with the 2.5% ruin ceiling switched off, so the cumulative cost of the
// hardstop is a measured number in the record rather than an assumption.
//
//   GET /api/journal            → last 30 entries
//   GET /api/journal?limit=90   → more (capped at 365)
export default async function handler(req, res) {
  try {
    if (!configured()) return res.status(200).json({ configured: false })
    const limit = Math.min(Math.max(parseInt(req.query?.limit, 10) || 30, 1), 365)
    const runs = (await getChainRuns()) ?? []
    const entries = runs
      .slice(-limit)
      .reverse()
      .map((r) => ({
        seq: r.seq,
        knownAt: r.knownAt,
        nav: r.nav,
        pnl: r.pnl ?? null,
        decision: r.decision,
        trades: r.orders, // Core book: side/qty/fill + grade + rationale, as sealed
        credit: r.credit ?? null, // Cycle Credit book: { pnl, orders }, as sealed
        // The control arm: the same Core strategy with the ruin ceiling off.
        // Absent on runs sealed before it existed, which is why it is
        // null-guarded rather than assumed.
        shadow: r.shadow ?? null,
        risk: r.risk ?? null,
        hash: r.hash,
      }))
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=600')
    return res.status(200).json({ configured: true, count: entries.length, entries })
  } catch (err) {
    return res.status(200).json({ configured: false, error: String(err.message || err) })
  }
}
