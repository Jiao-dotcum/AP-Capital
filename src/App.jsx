import { useMemo, useState } from 'react'
import { mulberry32 } from './engine/prng.js'
import { drawReading, riskOfRuin, RUIN_CEILING } from './engine/machine.js'
import { UNIVERSE } from './engine/assets.js'
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
import AllWeather from './components/AllWeather.jsx'
import PureAlpha from './components/PureAlpha.jsx'
import Register from './components/Register.jsx'
import MonteCarlo from './components/MonteCarlo.jsx'
import Ledger from './components/Ledger.jsx'
import Safeguards from './components/Safeguards.jsx'

const SEED = 20260705
const TRAIL_LENGTH = 6
const DEFAULT_ELECTED = ['usEq', 'ust10', 'tips', 'gold', 'gsci', 'cash']

export default function App() {
  // One seeded generator for the life of the session: reproducible releases.
  const [engine] = useState(() => {
    const rng = mulberry32(SEED)
    return { rng, first: drawReading(rng, null) }
  })
  const [trail, setTrail] = useState(() => [engine.first])
  const [elected, setElected] = useState(() => new Set(DEFAULT_ELECTED))
  const [apiKey, setApiKey] = useState('')
  const [status, setStatus] = useState({ kind: 'idle', text: 'Feed: simulated · seeded generator' })
  const [fetching, setFetching] = useState(false)

  const current = trail[trail.length - 1]
  const risk = riskOfRuin(current)
  const breached = risk > RUIN_CEILING

  const electedAssets = useMemo(
    () => UNIVERSE.filter((a) => elected.has(a.id)),
    [elected],
  )

  const pushReading = (reading) =>
    setTrail((t) => [...t, reading].slice(-TRAIL_LENGTH))

  const simulate = () => {
    pushReading(drawReading(engine.rng, current))
    setStatus({ kind: 'idle', text: 'Feed: simulated · seeded generator' })
  }

  const fetchLive = async () => {
    setFetching(true)
    setStatus({ kind: 'idle', text: 'Consulting the wire — web search in progress…' })
    try {
      const { prints, reading } = await fetchLiveMacro(apiKey.trim())
      pushReading(reading)
      setStatus({
        kind: 'live',
        text: `Feed: live · GDP ${prints.gdp_saar}% · Core CPI ${prints.core_cpi_yoy}% · Policy ${prints.policy_rate}%`,
      })
    } catch (err) {
      pushReading(drawReading(engine.rng, current))
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
        <button
          type="button"
          className="btn btn--outline"
          onClick={fetchLive}
          disabled={fetching}
        >
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

      <section className="section" aria-labelledby="sec-machine">
        <SectionHead
          numeral="I"
          title="The Machine"
          note="Two surprises drive everything: growth against what was priced, inflation against what was priced. The compass reads the regime; the gears turn beneath it."
        />
        <div className="grid-hero">
          <div className="panel">
            <Compass trail={trail} />
          </div>
          <Gears current={current} />
        </div>
        <Releases current={current} />
      </section>

      <ColumnDivider />

      <section className="section">
        <SectionHead
          numeral="II"
          title="Beta — All Weather"
          note="The strategic book. Harvest the risk premium in every season by balancing risk, not capital."
        />
        <AllWeather />
      </section>

      <ColumnDivider />

      <section className="section">
        <SectionHead
          numeral="III"
          title="Alpha — Pure Alpha"
          note="The tactical book. Written principles, systematically applied — the same input always yields the same tilt."
        />
        <PureAlpha current={current} />
      </section>

      <ColumnDivider />

      <section className="section">
        <SectionHead
          numeral="IV"
          title="The Register"
          note="Fifteen liquid holdings scored on the current surprises and ranked into five tiers, best to worst. Tick to elect into the working portfolio."
        />
        <Register current={current} elected={elected} onToggle={toggleAsset} />
      </section>

      <ColumnDivider />

      <section className="section">
        <SectionHead
          numeral="V"
          title="Monte Carlo Simulation"
          note="Four hundred paths of the elected book over ten years. The distribution is the forecast."
        />
        <MonteCarlo assets={electedAssets} />
      </section>

      <ColumnDivider />

      <section className="section">
        <SectionHead
          numeral="VI"
          title="Returns Ledger"
          note="The analytic account of every elected holding, stated in the measures appropriate to liquid assets."
        />
        <Ledger assets={electedAssets} />
      </section>

      <ColumnDivider />

      <section className="section">
        <SectionHead
          numeral="VII"
          title="Safeguards"
          note="The machine assumes it will sometimes be wrong. The question is only how much that costs."
        />
        <Safeguards current={current} />
      </section>

      <Footer />
    </div>
  )
}
