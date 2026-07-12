import { createHash } from 'node:crypto'
import { mulberry32 } from '../../src/engine/prng.js'
import { SEED, DEFAULT_ELECTED, seedWorld, advanceWorld } from '../../src/engine/world.js'
import { UNIVERSE, CASH_RATE } from '../../src/engine/assets.js'
import { regimeOf, riskOfRuin, RUIN_CEILING } from '../../src/engine/machine.js'
import { postureOf, triggersFrom, deployAuthorized, houseView, creditWeightsFor } from '../../src/engine/cycle.js'
import { buildRiskReport, DERISK_SCHEDULE, CORE_GROSS } from '../../src/engine/risk.js'
import { gradeBook } from '../../src/engine/grades.js'
import { initBook, markStep, reconcile, targetPositions, planOrders, execute, bookNav, LIMITS } from '../../src/engine/oms.js'
import { sleeveReturns } from '../../src/engine/proxies.js'

// ————— Phase 2: the canonical server-side engine run —————
// Each scheduled ingest with a fresh reading advances ONE canonical world —
// through the SAME advanceWorld the browser uses (Invariant 2) — rebalances
// ONE canonical paper book, and appends the result as a hash-chained record:
// hash = sha256(prevHash | canonical-JSON(payload)). Tampering with any
// stored decision breaks every hash after it, so the decision/blotter/NAV
// history is auditable, not just stored. Everything here is pure computation
// over the inputs (no I/O, no env) except the hash, which is node:crypto —
// server-side only, so engine purity (Invariant 1) is preserved by keeping
// this file under api/ rather than src/engine/.

// Canonical JSON: keys sorted at every depth, so the same object always
// hashes identically regardless of construction order. Dates serialize as
// their ISO string (as JSON.stringify would) — a TIMESTAMPTZ read back from
// Postgres arrives as a JS Date and must hash identically to the ISO string
// it was stored from, or verifying a persisted chain would always fail.
export function stableStringify(x) {
  if (x instanceof Date) return JSON.stringify(x.toISOString())
  if (x === null || typeof x !== 'object') return JSON.stringify(x)
  if (Array.isArray(x)) return `[${x.map(stableStringify).join(',')}]`
  // Skip undefined-valued keys, exactly as JSON.stringify does — otherwise a
  // field that is absent on a stored record but explicitly undefined on a
  // fresh one would hash differently.
  const keys = Object.keys(x).filter((k) => x[k] !== undefined).sort()
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(x[k])}`).join(',')}}`
}

export const GENESIS = 'GENESIS'

export const runHash = (prevHash, payload) =>
  createHash('sha256').update(`${prevHash ?? GENESIS}|${stableStringify(payload)}`).digest('hex')

// The hashed portion of a run record — the decision itself, not the carried
// world/book state (those are derivable by replaying the chain). `pnl` and
// `risk` (the daily journal blocks) seal with the record when present.
export const payloadOf = (run) => ({
  seq: run.seq,
  knownAt: run.knownAt,
  reading: run.reading,
  hyOasBp: run.hyOasBp ?? null,
  decision: run.decision,
  orders: run.orders,
  nav: run.nav,
  // != null, not !== undefined: a stored run without these blocks reads back
  // from JSONB as null, and must hash identically to the fresh run that
  // never had the keys at all.
  ...(run.pnl != null ? { pnl: run.pnl } : {}),
  ...(run.risk != null ? { risk: run.risk } : {}),
})

// A repeat curl with identical FRED data must not append a duplicate run —
// the chain records decisions, not invocations. A changed dial override IS a
// decision (the human ratified something new), so it appends even when the
// macro data hasn't moved.
export const unchangedSinceRun = (prevRun, { reading, hyOasBp = null, dialOverride = null }) =>
  Boolean(prevRun) &&
  stableStringify(prevRun.reading) === stableStringify(reading) &&
  (prevRun.hyOasBp ?? null) === (hyOasBp ?? null) &&
  (prevRun.decision?.dialOverride ?? null) === (dialOverride ?? null)

// Advance the canonical world + book by one reading and seal the record.
// Pure and deterministic: same prevRun + same inputs ⇒ byte-identical run.
// `dialOverride` is the human-ratified dial (The Charter's override, served
// from the append-only dial_overrides table): non-null pins the dial, null
// resumes automatic. It applies to the world BEFORE advancing so the sleeve
// weights, feed entries, and the book's rebalance all see the ratified value.
export function runEngineStep(prevRun, { reading, hyOasBp = null, knownAt, prices = null, dialOverride = null }) {
  const world0 = { ...(prevRun?.world ?? seedWorld()), dialOverride: dialOverride ?? null }
  const book0 = prevRun?.book ?? initBook()
  // With a live spread advanceWorld makes no rng draw; the generator exists so
  // a missing spread still evolves the cycle deterministically per-step
  // (Invariant 3: new randomness gets its own seeded mulberry32).
  const rng = mulberry32(SEED ^ (world0.releaseN + 1))
  const world = advanceWorld(rng, world0, reading, hyOasBp)
  const dial = world.dialOverride ?? world.autoDial

  // The canonical book is the All Weather Core mandate: the default elected
  // set sized by risk parity at fixed 1.0× gross. THE DECOUPLING: the dial
  // no longer enters this book — its authority is scoped to the credit
  // mandate (recorded in the decision, not traded by this OMS). The full
  // risk report (not just weights) feeds the sealed risk block below.
  const elected = UNIVERSE.filter((a) => DEFAULT_ELECTED.includes(a.id))
  const rr = buildRiskReport(elected)
  const rp = rr.rp

  // Marks: real closes where the price feed has them, factor model elsewhere —
  // identical to the browser's rebalance path.
  const real = sleeveReturns(prices)
  const markReturns = real ? { ...markStep(reading), ...real } : markStep(reading)
  const marked = reconcile(book0, markReturns, `R${world.releaseN}`)

  const ruin = riskOfRuin(reading)
  const ruinBreached = ruin > RUIN_CEILING
  const targets = targetPositions(marked, rp.weights)
  const regime = regimeOf(reading)
  const posture = postureOf(dial)

  // ————— The journal: every order carries its reason, sealed with the trade.
  // Deterministic text from the same decision state that produced the order —
  // written at planning time, not reconstructed after the fact.
  const grades = gradeBook({ g: reading.g, i: reading.i, dial })
  const navPlan = bookNav(marked)
  const wOf = (qty, id) => +((qty * marked.marks[id]) / navPlan).toFixed(4)
  const orders = planOrders(marked, targets).map((o) => {
    const currentW = wOf(marked.positions[o.id]?.qty ?? 0, o.id)
    const targetW = wOf(targets[o.id] ?? 0, o.id)
    const g = grades[o.id]
    const capped = (rp.weights[o.id] ?? 0) * navPlan > LIMITS.maxName * navPlan - 1
    const rationale =
      `${o.side} to move ${o.name} from ${(currentW * 100).toFixed(1)}% to ${(targetW * 100).toFixed(1)}% of NAV: ` +
      `All Weather Core mandate — four-season risk parity (standalone-vol equalization) at fixed ${CORE_GROSS.toFixed(1)}× gross, ` +
      `regime ${regime.label}. Unified grade ${g.letter} (${g.score}).` +
      (capped ? ` Target clipped by the ${LIMITS.maxName * 100}% single-name cap.` : '') +
      (ruinBreached ? ' Ruin ceiling breached — reduce-only session.' : '')
    return { ...o, currentW, targetW, grade: { letter: g.letter, score: g.score }, rationale }
  })
  const { book, filled, vetoed } = execute(marked, orders, { ruinBreached })
  const nav = +bookNav(book).toFixed(2)

  const triggers = triggersFrom(world.cycle)
  const decision = {
    regime: regime.key,
    dial, // governs the Cycle Credit mandate only (the decoupling)
    dialOverride: dialOverride ?? null, // non-null = this dial was human-ratified
    posture: posture.word,
    sleeveWeights: houseView(dial), // firm five-sleeve view: Core fixed, credit dial-scoped, %
    creditSleeves: creditWeightsFor(dial), // [performing, distressed, powder] % of the credit mandate
    rpWeights: Object.fromEntries(Object.entries(rp.weights).map(([k, v]) => [k, +v.toFixed(4)])), // Core book, fraction of NAV
    gross: +rp.gross.toFixed(3), // fixed CORE_GROSS by construction
    triggersArmed: triggers.filter((t) => t.armed).map((t) => t.name),
    deploy: deployAuthorized(triggers),
    ruin: +ruin.toFixed(4),
    ruinBreached,
    filled,
    vetoed,
  }

  // ————— Daily P&L attribution. dayPnl per asset is the mark move on the
  // position held INTO the day (q0 × Δmark) — trades executed today start
  // earning tomorrow. `change` marks are close-over-prior-close (the full
  // economic day, overnight gap included); `intraday` (open→close, when the
  // price feed carries it) is journaled alongside for the session's tape.
  const navStart = +bookNav(book0).toFixed(2)
  const navMarked = +bookNav(marked).toFixed(2)
  const perAsset = []
  for (const a of UNIVERSE) {
    const q0 = book0.positions[a.id]?.qty ?? 0
    const qEnd = book.positions[a.id]?.qty ?? 0
    if (q0 === 0 && qEnd === 0) continue
    perAsset.push({
      id: a.id,
      name: a.name,
      cls: a.cls,
      qty: +qEnd.toFixed(2),
      mark: +book.marks[a.id].toFixed(4),
      alloc: Math.round(qEnd * book.marks[a.id]), // dollars of NAV in this asset
      weight: +((qEnd * book.marks[a.id]) / nav).toFixed(4),
      capHeadroom: +(LIMITS.maxName - (qEnd * book.marks[a.id]) / nav).toFixed(4),
      dayReturnPct: +(markReturns[a.id] ?? 0).toFixed(2),
      dayPnl: +(q0 * (marked.marks[a.id] - book0.marks[a.id])).toFixed(2),
    })
  }
  const pnl = {
    navStart,
    navEnd: nav,
    dayPnl: +(navMarked - navStart).toFixed(2), // mark-to-market incl. cash yield
    tradingCost: +(nav - navMarked).toFixed(2), // slippage paid on today's fills
    cashYield: +(book0.cash * (CASH_RATE / 100 / 12)).toFixed(2),
    realized: +book.realized.toFixed(2), // cumulative
    unrealized: book.history[book.history.length - 1]?.unrealized ?? 0,
    perAsset,
  }

  // ————— The sealed risk statement: how much capital sits where, what the
  // tail looks like, and which standing rule binds next.
  const navPeak = Math.max(...book.history.map((h) => h.nav), nav)
  const drawdown = +(1 - nav / navPeak).toFixed(4)
  let deriskGross = 1
  for (const s of DERISK_SCHEDULE) if (drawdown > s.beyond) deriskGross = s.gross
  const risk = {
    portfolioVolAnnualPct: +(rr.moments.sigma * 100).toFixed(2),
    es95MonthlyPct: rr.boot.es95, // expected shortfall, % of book, monthly
    es99MonthlyPct: rr.boot.es99,
    cvar95Dollar: Math.round((rr.boot.es95 / 100) * nav),
    cvar99Dollar: Math.round((rr.boot.es99 / 100) * nav),
    maxDD: rr.boot.maxDD, // bootstrap median / p95 max drawdown, %
    seasons: rp.seasons.map((s) => ({ name: s.name, capitalPct: s.capital, riskPct: s.risk })),
    grossTarget: +rp.gross.toFixed(3),
    grossCeiling: LIMITS.grossCeiling,
    caps: { maxNamePct: LIMITS.maxName * 100, maxClassPct: LIMITS.maxClass * 100 },
    drawdown: { currentPct: +(drawdown * 100).toFixed(2), deriskGross, schedule: DERISK_SCHEDULE },
    replays: rr.replays, // named crisis replays of TODAY'S weights
    ruinCeiling: RUIN_CEILING,
  }

  const run = {
    seq: world.releaseN,
    knownAt,
    reading,
    hyOasBp: hyOasBp ?? null,
    decision,
    orders: book.blotter.slice(0, filled + vetoed), // this run's blotter entries, rationale included
    nav,
    pnl,
    risk,
    world,
    book,
    prevHash: prevRun?.hash ?? null,
  }
  run.hash = runHash(run.prevHash, payloadOf(run))
  return run
}

// Recompute every link. Returns { ok, brokenAt } — brokenAt is the seq of the
// first record whose stored hash does not match its recomputed hash (or whose
// prevHash does not point at its predecessor).
export function verifyChain(runs) {
  let prevHash = null
  for (const run of runs) {
    if ((run.prevHash ?? null) !== prevHash) return { ok: false, brokenAt: run.seq }
    if (runHash(prevHash, payloadOf(run)) !== run.hash) return { ok: false, brokenAt: run.seq }
    prevHash = run.hash
  }
  return { ok: true, brokenAt: null }
}
