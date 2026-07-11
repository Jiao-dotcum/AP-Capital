import { createHash } from 'node:crypto'
import { mulberry32 } from '../../src/engine/prng.js'
import { SEED, DEFAULT_ELECTED, seedWorld, advanceWorld } from '../../src/engine/world.js'
import { UNIVERSE } from '../../src/engine/assets.js'
import { regimeOf, riskOfRuin, RUIN_CEILING } from '../../src/engine/machine.js'
import { postureOf, triggersFrom, deployAuthorized } from '../../src/engine/cycle.js'
import { buildRiskReport } from '../../src/engine/risk.js'
import { initBook, markStep, reconcile, targetPositions, planOrders, execute, bookNav } from '../../src/engine/oms.js'
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
// hashes identically regardless of construction order.
export function stableStringify(x) {
  if (x === null || typeof x !== 'object') return JSON.stringify(x)
  if (Array.isArray(x)) return `[${x.map(stableStringify).join(',')}]`
  const keys = Object.keys(x).sort()
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(x[k])}`).join(',')}}`
}

export const GENESIS = 'GENESIS'

export const runHash = (prevHash, payload) =>
  createHash('sha256').update(`${prevHash ?? GENESIS}|${stableStringify(payload)}`).digest('hex')

// The hashed portion of a run record — the decision itself, not the carried
// world/book state (those are derivable by replaying the chain).
export const payloadOf = (run) => ({
  seq: run.seq,
  knownAt: run.knownAt,
  reading: run.reading,
  hyOasBp: run.hyOasBp ?? null,
  decision: run.decision,
  orders: run.orders,
  nav: run.nav,
})

// A repeat curl with identical FRED data must not append a duplicate run —
// the chain records decisions, not invocations.
export const unchangedSinceRun = (prevRun, { reading, hyOasBp = null }) =>
  Boolean(prevRun) &&
  stableStringify(prevRun.reading) === stableStringify(reading) &&
  (prevRun.hyOasBp ?? null) === (hyOasBp ?? null)

// Advance the canonical world + book by one reading and seal the record.
// Pure and deterministic: same prevRun + same inputs ⇒ byte-identical run.
export function runEngineStep(prevRun, { reading, hyOasBp = null, knownAt, prices = null }) {
  const world0 = prevRun?.world ?? seedWorld()
  const book0 = prevRun?.book ?? initBook()
  // With a live spread advanceWorld makes no rng draw; the generator exists so
  // a missing spread still evolves the cycle deterministically per-step
  // (Invariant 3: new randomness gets its own seeded mulberry32).
  const rng = mulberry32(SEED ^ (world0.releaseN + 1))
  const world = advanceWorld(rng, world0, reading, hyOasBp)
  const dial = world.dialOverride ?? world.autoDial

  // The canonical book runs the default elected set — the same six sleeves the
  // dashboard elects on load — sized by the same risk-parity engine.
  const elected = UNIVERSE.filter((a) => DEFAULT_ELECTED.includes(a.id))
  const rp = buildRiskReport(elected, dial).rp

  // Marks: real closes where the price feed has them, factor model elsewhere —
  // identical to the browser's rebalance path.
  const real = sleeveReturns(prices)
  const markReturns = real ? { ...markStep(reading), ...real } : markStep(reading)
  const marked = reconcile(book0, markReturns, `R${world.releaseN}`)

  const ruin = riskOfRuin(reading)
  const ruinBreached = ruin > RUIN_CEILING
  const targets = targetPositions(marked, rp.weights)
  const { book, filled, vetoed } = execute(marked, planOrders(marked, targets), { ruinBreached })
  const nav = +bookNav(book).toFixed(2)

  const triggers = triggersFrom(world.cycle)
  const decision = {
    regime: regimeOf(reading).key,
    dial,
    posture: postureOf(dial).word,
    sleeveWeights: world.weights, // five-sleeve anchor weights, %
    rpWeights: Object.fromEntries(Object.entries(rp.weights).map(([k, v]) => [k, +v.toFixed(4)])), // fraction of NAV
    gross: +rp.gross.toFixed(3),
    triggersArmed: triggers.filter((t) => t.armed).map((t) => t.name),
    deploy: deployAuthorized(triggers),
    ruin: +ruin.toFixed(4),
    ruinBreached,
    filled,
    vetoed,
  }

  const run = {
    seq: world.releaseN,
    knownAt,
    reading,
    hyOasBp: hyOasBp ?? null,
    decision,
    orders: book.blotter.slice(0, filled + vetoed), // this run's blotter entries
    nav,
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
