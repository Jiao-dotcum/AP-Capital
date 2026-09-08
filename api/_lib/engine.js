import { createHash } from 'node:crypto'
import { mulberry32 } from '../../src/engine/prng.js'
import { SEED, DEFAULT_ELECTED, seedWorld, advanceWorld } from '../../src/engine/world.js'
import { UNIVERSE, CASH_RATE } from '../../src/engine/assets.js'
import { regimeOf, riskOfRuin, RUIN_CEILING } from '../../src/engine/machine.js'
import { postureOf, triggersFrom, deployAuthorized, houseView, creditWeightsFor } from '../../src/engine/cycle.js'
import { tradedIssuers } from '../../src/engine/credit.js'
import { buildRiskReport, DERISK_SCHEDULE, CORE_GROSS } from '../../src/engine/risk.js'
import { pureAlphaTilt, coreTargets } from '../../src/engine/pureAlpha.js'
import { gradeBook } from '../../src/engine/grades.js'
import { initBook, markStep, reconcile, targetPositions, planOrders, execute, bookNav, LIMITS } from '../../src/engine/oms.js'
import { sleeveReturns } from '../../src/engine/proxies.js'
import { stepCreditBook } from './creditBook.js'

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
  ...(run.credit != null ? { credit: run.credit } : {}),
  ...(run.shadow != null ? { shadow: run.shadow } : {}),
})

// A short, stable fingerprint of the exact price map used to mark the book.
// Sealed inside `decision` (not as a new top-level field) deliberately: the
// decision block is JSONB stored and read back wholesale, so it survives the
// database round-trip with no schema change and no db.js edit — and a run
// stored BEFORE this field existed simply lacks the key, which
// stableStringify skips, so every historical hash still verifies.
export const priceFingerprint = (prices) =>
  prices && Object.keys(prices).length
    ? createHash('sha256').update(stableStringify(prices)).digest('hex').slice(0, 16)
    : null

// The set of real issuers actually traded, order-independent — the identity
// that matters for "did the traded universe change", ignoring daily drift in
// any single name's KMV-derived numbers.
const realIssuerKey = (rows) =>
  (rows ?? [])
    .map((r) => r.id)
    .sort()
    .join(',')

// A repeat curl with identical inputs must not append a duplicate run — the
// chain records decisions, not invocations. Four things count as a new
// decision:
//   1. the FRED reading or the spread moved (the macro input changed);
//   2. the dial override changed (a human ratified something new);
//   3. the SET of real issuers changed — the desk's traded universe is
//      different, which is a decision even if the macro is quiet (this is
//      also what lets the real desk activate the same day EDGAR + Alpaca
//      first both clear, instead of waiting for the next FRED print);
//   4. the closes moved — a trading day where the market moved but FRED was
//      quiet still produced real P&L, and a daily journal that skips it has
//      a hole in it. Gated on the fingerprint, so re-curling the SAME closes
//      still appends nothing.
// A null realIssuers/prices means "not fetched this run" (unconfigured, or a
// transient failure), never "changed to empty" — those carry forward.
export const unchangedSinceRun = (prevRun, { reading, hyOasBp = null, dialOverride = null, prices = null, realIssuers = null }) => {
  if (!prevRun) return false
  if (stableStringify(prevRun.reading) !== stableStringify(reading)) return false
  if ((prevRun.hyOasBp ?? null) !== (hyOasBp ?? null)) return false
  if ((prevRun.decision?.dialOverride ?? null) !== (dialOverride ?? null)) return false
  if (realIssuers && realIssuerKey(realIssuers) !== realIssuerKey(prevRun.decision?.realIssuers)) return false
  const fp = priceFingerprint(prices)
  if (fp && fp !== (prevRun.decision?.priceFingerprint ?? null)) return false
  return true
}

// Advance the canonical world + book by one reading and seal the record.
// Pure and deterministic: same prevRun + same inputs ⇒ byte-identical run.
// `dialOverride` is the human-ratified dial (The Charter's override, served
// from the append-only dial_overrides table): non-null pins the dial, null
// resumes automatic. It applies to the world BEFORE advancing so the sleeve
// weights, feed entries, and the book's rebalance all see the ratified value.
export function runEngineStep(prevRun, { reading, hyOasBp = null, knownAt, prices = null, dialOverride = null, realIssuers = null }) {
  const world0 = {
    ...(prevRun?.world ?? seedWorld()),
    dialOverride: dialOverride ?? null,
    // A null realIssuers this run (feature unconfigured, or a transient
    // EDGAR/Alpaca failure) carries forward whatever the desk already had —
    // real fundamentals don't change daily, so a one-day fetch hiccup
    // shouldn't empty the real book. A fresh array (even []) always wins.
    realIssuers: realIssuers ?? prevRun?.world?.realIssuers ?? [],
  }
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
  // The Core book = risk parity + the Pure Alpha overlay (vol-targeted,
  // long-only clamped, gross ≤ 1 — see pureAlpha.js). Gate evidence: blend
  // beat rp-only Sharpe 23/30 seeds, avg 0.313 → 0.358, +0.41pp maxDD.
  const pa = pureAlphaTilt(reading.g, reading.i)
  const targets = targetPositions(marked, coreTargets(rp.weights, pa.tilt))
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
    const paPP = (pa.tilt[o.id] ?? 0) * 100
    const rationale =
      `${o.side} to move ${o.name} from ${(currentW * 100).toFixed(1)}% to ${(targetW * 100).toFixed(1)}% of NAV: ` +
      `All Weather Core mandate — four-season risk parity (standalone-vol equalization) at fixed ${CORE_GROSS.toFixed(1)}× gross, ` +
      `regime ${regime.label}. Unified grade ${g.letter} (${g.score}).` +
      (Math.abs(paPP) >= 0.5 ? ` Pure Alpha tilt ${paPP > 0 ? '+' : '−'}${Math.abs(paPP).toFixed(1)}pp (${pa.fired.join(', ')}).` : '') +
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
    rpWeights: Object.fromEntries(Object.entries(rp.weights).map(([k, v]) => [k, +v.toFixed(4)])), // risk parity BEFORE the overlay
    // What the book actually targeted: risk parity WITH the Pure Alpha tilt,
    // long-only clamped, gross ≤ 1. rpWeights above is the pre-overlay input,
    // so anything mirroring the traded book (the broker) must use THIS.
    //
    // FLOORED to 4dp, not rounded. Rounding to nearest let five sleeves each
    // round UP by up to 0.00005, so the sealed copy read gross 1.0001 while
    // the book it described was exactly 1.0 — a display convenience quietly
    // breaching the Charter's gross ceiling in the one number a real broker
    // would size from. Flooring can only ever understate gross, never
    // overstate it, which is the direction a hard ceiling must round.
    coreTargetWeights: Object.fromEntries(
      Object.entries(coreTargets(rp.weights, pa.tilt)).map(([k, v]) => [k, Math.floor(v * 1e4) / 1e4]),
    ),
    pureAlpha: { fired: pa.fired, gross: pa.gross, tilt: pa.tilt }, // the overlay actually traded
    gross: +rp.gross.toFixed(3), // fixed CORE_GROSS by construction
    triggersArmed: triggers.filter((t) => t.armed).map((t) => t.name),
    deploy: deployAuthorized(triggers),
    ruin: +ruin.toFixed(4),
    ruinBreached,
    filled,
    vetoed,
    // The real trading desk (2026-07-13): live-verified issuers actually
    // traded this run, sealed here so a change in real-market inputs (a
    // filing revision, a leverage fix clearing a gate) is as tamper-evident
    // as any other decision input. Empty until EDGAR + Alpaca both clear a
    // name (api/_lib/realIssuers.js) — see tradedIssuers, engine/credit.js.
    realIssuers: world.realIssuers.map((r) => ({
      id: r.id, name: r.name, sector: r.sector, rating: r.rating,
      lev: r.lev, cov: r.cov, mult: r.mult, av: r.av, price: r.price,
      source: r.source, fiscalEnd: r.fiscalEnd ?? null, priceAsOf: r.priceAsOf ?? null,
    })),
    // The exact closes this run marked against — what unchangedSinceRun
    // compares to decide whether a quiet-macro day still deserves a record.
    // Null when the price feed is unconfigured (the book marked on the
    // factor model), which never counts as a change.
    priceFingerprint: priceFingerprint(prices),
    marksSource: real ? 'live-closes' : 'factor-model',
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

  // ————— The control arm: the same strategy with the ruin ceiling off —————
  // A second Core book, identical to the canonical one in every respect
  // EXCEPT that `ruinBreached` is never passed to compliance. It exists to
  // MEASURE the hardstop rather than assume it: the cumulative gap between
  // the two NAVs is what the 2.5% ceiling has cost (or saved) since
  // inception, in dollars, on the firm's own data.
  //
  // It must re-plan against its OWN positions and NAV, not merely skip the
  // veto on the canonical orders. Once the books diverge their target
  // QUANTITIES differ even though their target WEIGHTS are identical — a
  // counterfactual that reused the canonical order sizes would drift for a
  // second reason and stop measuring the ceiling alone.
  //
  // This is a measurement, not a second strategy. It never trades, never
  // feeds the Firm's decisions, and is labeled a control arm everywhere it
  // surfaces (see docs/RISK_POLICY.md §4).
  const shadow0 = prevRun?.shadowBook ?? initBook()
  const shadowMarked = reconcile(shadow0, markReturns, `R${world.releaseN}`)
  const shadowExec = execute(
    shadowMarked,
    planOrders(shadowMarked, targetPositions(shadowMarked, coreTargets(rp.weights, pa.tilt))),
    { ruinBreached: false },
  )
  const shadowNavStart = +bookNav(shadow0).toFixed(2)
  const shadowNavMarked = +bookNav(shadowMarked).toFixed(2)
  const shadowNav = +bookNav(shadowExec.book).toFixed(2)
  const shadow = {
    navStart: shadowNavStart,
    navEnd: shadowNav,
    dayPnl: +(shadowNavMarked - shadowNavStart).toFixed(2),
    tradingCost: +(shadowNav - shadowNavMarked).toFixed(2),
    filled: shadowExec.filled,
    vetoed: shadowExec.vetoed, // cap breaches still bind — only the RUIN gate is off
    // The number the whole arm exists to produce. Positive = the ceiling has
    // cost the firm money; negative = it has protected it.
    divergence: +(shadowNav - nav).toFixed(2),
    divergencePct: +((shadowNav / nav - 1) * 100).toFixed(3),
    haltedToday: ruinBreached,
    haltedDays: (prevRun?.shadow?.haltedDays ?? 0) + (ruinBreached ? 1 : 0),
    orders: shadowExec.book.blotter.slice(0, shadowExec.filled + shadowExec.vetoed),
  }

  // ————— The Cycle Credit mandate's paper book, stepped on the same run —
  // its own $1M NAV, trades with reasons, sealed alongside the Core's. The
  // traded universe (tradedIssuers) is the SAME union world.js's screen used
  // above — the desk the Firm's feed narrates and the desk that actually
  // holds positions never diverge.
  const creditStep = stepCreditBook(prevRun?.creditBook ?? null, {
    cycle: world.cycle,
    dial,
    dialOverride,
    issuers: tradedIssuers(world.realIssuers),
  })
  const credit = { pnl: creditStep.pnl, orders: creditStep.orders }

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
    credit,
    shadow,
    world,
    book,
    creditBook: creditStep.book,
    shadowBook: shadowExec.book,
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
