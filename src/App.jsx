import { useMemo, useState } from 'react'
import { mulberry32 } from './engine/prng.js'
import { drawReading, riskOfRuin, RUIN_CEILING } from './engine/machine.js'
import { UNIVERSE } from './engine/assets.js'
import {
  CYCLE0,
  evolveCycle,
  proxyScores,
  dialFrom,
  postureOf,
  weightsFor,
  triggersFrom,
  deployAuthorized,
} from './engine/cycle.js'
import { screenPerforming } from './engine/credit.js'
import { buildFeed, memoFrom } from './engine/firm.js'
import { fetchLiveMacro } from './live/fetchLive.js'
import {
  Masthead,
  SectionHead,
  ColumnDivider,
  HardstopBanner,
  Footer,
} from './components/chrome.jsx'
import Compass from './components/Compass.jsx'
import Gears from './components/Gears.jsx'
import Releases from './components/Releases.jsx'
import CycleGauge from './components/CycleGauge.jsx'
import AllWeather from './components/AllWeather.jsx'
import PureAlpha from './components/PureAlpha.jsx'
import Desks from './components/Desks.jsx'
import Register from './components/Register.jsx'
import Allocation from './components/Allocation.jsx'
import MonteCarlo from './components/MonteCarlo.jsx'
import Ledger from './components/Ledger.jsx'
import Firm from './components/Firm.jsx'
import Safeguards from './components/Safeguards.jsx'

const SEED = 20260705
const TRAIL_LENGTH = 6
const FEED_LENGTH = 32
const DEFAULT_ELECTED = ['usEq', 'ust10', 'tips', 'gold', 'gsci', 'cash']

// Build the whole per-release state transition in one pure step so the
// simulate and live-fetch paths share it.
function advanceWorld(rng, world, reading) {
  const cycle = evolveCycle(rng, world.cycle, reading)
  const dial = world.dialOverride ?? dialFrom(proxyScores(cycle))
  const weights = weightsFor(dial)
  const screen = screenPerforming(cycle)
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
    weights,
    releaseN: n,
    feed: [...entries, ...world.feed].slice(0, FEED_LENGTH),
    vetoCount: world.vetoCount + entries.filter((e) => e.tone === 'veto').length,
  }
}

export default function App() {
  // One seeded generator for the life of the session: reproducible releases.
  const [engine] = useState(() => {
    const rng = mulberry32(SEED)
    const first = drawReading(rng, null)
    const seedWorld = {
      trail: [],
      cycle: CYCLE0,
      weights: weightsFor(dialFrom(proxyScores(CYCLE0))),
      releaseN: 0,
      feed: [],
      vetoCount: 0,
      dialOverride: null,
    }
    return { rng, world: advanceWorld(rng, seedWorld, first) }
  })
  const [world, setWorld] = useState(engine.world)
  const [elected, setElected] = useState(() => new Set(DEFAULT_ELECTED))
  const [apiKey, setApiKey] = useState('')
  const [status, setStatus] = useState({ kind: 'idle', text: 'Feed: simulated · seeded generator' })
  const [fetching, setFetching] = useState(false)

  const current = world.trail[world.trail.length - 1]
  const risk = riskOfRuin(current)
  const breached = risk > RUIN_CEILING

  // Derived Oaktree state — deterministic per cycle print, cheap to recompute.
  const scores = useMemo(() => proxyScores(world.cycle), [world.cycle])
  const autoDial = dialFrom(scores)
  const dial = world.dialOverride ?? autoDial
  const weights = useMemo(() => weightsFor(dial), [dial])
  const screen = useMemo(() => screenPerforming(world.cycle), [world.cycle])
  const triggers = useMemo(() => triggersFrom(world.cycle), [world.cycle])
  const deploy = deployAuthorized(triggers)
  const memo = useMemo(
    () =>
      memoFrom({
        releaseN: world.releaseN,
        dial,
        posture: postureOf(dial),
        cycle: world.cycle,
        screen,
        weights,
        deploy,
      }),
    [world.releaseN, dial, world.cycle, screen, weights, deploy],
  )

  const electedAssets = useMemo(() => UNIVERSE.filter((a) => elected.has(a.id)), [elected])

  const simulate = () => {
    const reading = drawReading(engine.rng, current)
    setWorld((w) => advanceWorld(engine.rng, w, reading))
    setStatus({ kind: 'idle', text: 'Feed: simulated · seeded generator' })
  }

  const fetchLive = async () => {
    setFetching(true)
    setStatus({ kind: 'idle', text: 'Consulting the wire — web search in progress…' })
    try {
      const { prints, reading } = await fetchLiveMacro(apiKey.trim())
      setWorld((w) => advanceWorld(engine.rng, w, reading))
      setStatus({
        kind: 'live',
        text: `Feed: live · GDP ${prints.gdp_saar}% · Core CPI ${prints.core_cpi_yoy}% · Policy ${prints.policy_rate}%`,
      })
    } catch (err) {
      const reading = drawReading(engine.rng, current)
      setWorld((w) => advanceWorld(engine.rng, w, reading))
      setStatus({
        kind: 'error',
        text: `Live fetch failed (${err.message}) — fell back to simulation`,
      })
    } finally {
      setFetching(false)
    }
  }

  const toggleAsset = (id) =>
    setElected((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })

  return (
    <div className="page">
      <Masthead />

      <div className="controls">
        <button type="button" className="btn" onClick={simulate}>
          Simulate Data Release
        </button>
        <input
          type="password"
          className="key-input"
          placeholder="Anthropic API Key"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          autoComplete="off"
          aria-label="Anthropic API key for live macro data"
        />
        <button type="button" className="btn btn--outline" onClick={fetchLive} disabled={fetching}>
          {fetching ? 'Fetching…' : 'Fetch Live Macro Data'}
        </button>
      </div>
      <p
        className={`statusline${
          status.kind === 'error' ? ' statusline--error' : status.kind === 'live' ? ' statusline--live' : ''
        }`}
        role="status"
      >
        {status.text}
      </p>

      {breached && <HardstopBanner risk={risk} ceiling={RUIN_CEILING} />}

      <section className="section">
        <SectionHead
          numeral="I"
          title="The Machine"
          note="The Bridgewater engine diagnoses the environment: growth against what was priced, inflation against what was priced. The compass reads the regime; the gears turn beneath it."
        />
        <div className="grid-hero">
          <div className="panel">
            <Compass trail={world.trail} />
          </div>
          <Gears current={current} />
        </div>
        <Releases current={current} />
      </section>

      <ColumnDivider />

      <section className="section">
        <SectionHead
          numeral="II"
          title="The Cycle"
          note="The Oaktree engine decides how aggressive to be within it. You cannot predict the cycle; you can measure where you stand and calibrate offense against defense."
        />
        <CycleGauge
          scores={scores}
          autoDial={autoDial}
          dial={dial}
          override={world.dialOverride}
          onOverride={(v) => setWorld((w) => ({ ...w, dialOverride: v }))}
          onResume={() => setWorld((w) => ({ ...w, dialOverride: null }))}
        />
      </section>

      <ColumnDivider />

      <section className="section">
        <SectionHead
          numeral="III"
          title="Beta — All Weather"
          note="The strategic book. Harvest the risk premium in every season by balancing risk, not capital."
        />
        <AllWeather />
      </section>

      <ColumnDivider />

      <section className="section">
        <SectionHead
          numeral="IV"
          title="Alpha — Pure Alpha"
          note="The tactical book. Written principles, systematically applied — the same input always yields the same tilt."
        />
        <PureAlpha current={current} />
      </section>

      <ColumnDivider />

      <section className="section">
        <SectionHead
          numeral="V"
          title="The Credit Desks"
          note="Bottom-up selection: the performing desk earns carry through the gates; the opportunistic desk holds powder and waits for despair. If we avoid the losers, the winners take care of themselves."
        />
        <Desks
          screen={screen}
          triggers={triggers}
          deploy={deploy}
          cycle={world.cycle}
          powderPct={weights[4] + (deploy ? 0 : weights[3])}
        />
      </section>

      <ColumnDivider />

      <section className="section">
        <SectionHead
          numeral="VI"
          title="The Register"
          note="Fifteen liquid holdings scored on the current surprises and ranked into five tiers, best to worst. Tick to elect into the working portfolio."
        />
        <Register current={current} elected={elected} onToggle={toggleAsset} />
      </section>

      <ColumnDivider />

      <section className="section">
        <SectionHead
          numeral="VII"
          title="The Allocation"
          note="Five sleeves, one dial. Bridgewater supplies the balance; Oaktree supplies the temperature; Marks supplies the patience."
        />
        <Allocation weights={weights} dial={dial} />
      </section>

      <ColumnDivider />

      <section className="section">
        <SectionHead
          numeral="VIII"
          title="Monte Carlo Simulation"
          note="Four hundred paths of the elected book over ten years. The distribution is the forecast."
        />
        <MonteCarlo assets={electedAssets} />
      </section>

      <ColumnDivider />

      <section className="section">
        <SectionHead
          numeral="IX"
          title="Returns Ledger"
          note="The analytic account of every elected holding, stated in the measures appropriate to liquid assets."
        />
        <Ledger assets={electedAssets} />
      </section>

      <ColumnDivider />

      <section className="section">
        <SectionHead
          numeral="X"
          title="The Firm"
          note="Every employee from intern to Co-CEO is an agent with a role, tools, and an artifact. Decisions flow up; nothing trades without passing each layer."
        />
        <Firm feed={world.feed} memo={memo} vetoCount={world.vetoCount} />
      </section>

      <ColumnDivider />

      <section className="section">
        <SectionHead
          numeral="XI"
          title="Safeguards"
          note="The machine assumes it will sometimes be wrong. The question is only how much that costs."
        />
        <Safeguards current={current} />
      </section>

      <Footer />
    </div>
  )
}
