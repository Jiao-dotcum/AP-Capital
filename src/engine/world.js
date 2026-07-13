import {
  CYCLE0,
  evolveCycle,
  cycleFromSpread,
  proxyScores,
  dialFrom,
  settleDial,
  houseView,
  triggersFrom,
  deployAuthorized,
} from './cycle.js'
import { screenPerforming, tradedIssuers } from './credit.js'
import { riskOfRuin, RUIN_CEILING } from './machine.js'
import { buildFeed } from './firm.js'

// ————— The world: one state transition, shared by every path —————
// Invariant 2 lives here. `advanceWorld` is THE per-release state transition:
// the browser's simulate button, its manual live fetch, its backend auto-load,
// AND the server's canonical engine run (api/_lib/engine.js) all import this
// exact function. If a path needs new per-release state, add it to the world
// object here — never advance the world any other way.

export const SEED = 20260705
export const HIST_LENGTH = 260 // five years of weekly cycle states in the rolling window
export const TRAIL_LENGTH = 6
export const FEED_LENGTH = 32
export const DEFAULT_ELECTED = ['usEq', 'ust10', 'tips', 'gold', 'gsci', 'cash']

// The pre-first-reading world. Every stream of releases starts from this.
export function seedWorld() {
  const dial0 = dialFrom(proxyScores(CYCLE0))
  return {
    trail: [],
    cycle: CYCLE0,
    cycleHist: [],
    autoDial: dial0,
    // houseView, not the legacy weightsFor: the Firm's own feed (buildFeed,
    // below) must see the decoupled allocation — Core fixed, credit
    // dial-scoped — or its L5/L6 narrative describes Core sleeve moves that
    // can no longer happen in the traded book.
    weights: houseView(dial0),
    releaseN: 0,
    feed: [],
    vetoCount: 0,
    dialOverride: null,
    // Real, live-verified issuers (Ford/Carnival/Occidental — see
    // api/_lib/realIssuers.js) merged additively onto the ten simulated
    // names by tradedIssuers below. Empty until a canonical run or backend
    // load supplies them — the desk behaves identically to before this
    // feature until then (Invariant 5).
    realIssuers: [],
  }
}

// Build the whole per-release state transition in one pure step so the
// simulate, live-fetch, and server-canonical paths share it.
export function advanceWorld(rng, world, reading, liveSpread = null) {
  const cycle = liveSpread ? cycleFromSpread(liveSpread) : evolveCycle(rng, world.cycle, reading)
  const cycleHist = [...world.cycleHist, cycle].slice(-HIST_LENGTH)
  // Percentile composite settled through the deadband: the dial holds until
  // the composite has genuinely moved.
  const autoDial = settleDial(world.autoDial, dialFrom(proxyScores(cycle, cycleHist)))
  const dial = world.dialOverride ?? autoDial
  const weights = houseView(dial) // Core fixed, credit dial-scoped — see seedWorld
  // world.realIssuers is not touched by this step — it's set once by the
  // caller (server ingest, or a backend-state load in the browser) and
  // carried forward via the spread below, exactly like dialOverride.
  const screen = screenPerforming(cycle, tradedIssuers(world.realIssuers))
  const triggers = triggersFrom(cycle)
  const ruin = riskOfRuin(reading)
  const n = world.releaseN + 1
  const entries = buildFeed({
    n,
    reading,
    cycle,
    dial,
    weights,
    prevWeights: world.weights,
    screen,
    triggers,
    deploy: deployAuthorized(triggers),
    risk: { value: ruin, breached: ruin > RUIN_CEILING },
  })
  return {
    ...world,
    trail: [...world.trail, reading].slice(-TRAIL_LENGTH),
    cycle,
    cycleHist,
    autoDial,
    weights,
    releaseN: n,
    feed: [...entries, ...world.feed].slice(0, FEED_LENGTH),
    vetoCount: world.vetoCount + entries.filter((e) => e.tone === 'veto').length,
  }
}
