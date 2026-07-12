import { useEffect, useMemo, useState } from 'react'
import { mulberry32 } from './engine/prng.js'
import { drawReading, regimeOf, riskOfRuin, RUIN_CEILING } from './engine/machine.js'
import { UNIVERSE } from './engine/assets.js'
import {
  proxyScores,
  dialFrom,
  postureOf,
  houseView,
  creditWeightsFor,
  triggersFrom,
  deployAuthorized,
} from './engine/cycle.js'
import { SEED, FEED_LENGTH, DEFAULT_ELECTED, seedWorld, advanceWorld } from './engine/world.js'
import { screenPerforming } from './engine/credit.js'
import { bestIdeas } from './engine/origination.js'
import { scanCatalysts } from './engine/sourcing.js'
import { memoFrom, quarterLabel } from './engine/firm.js'
import { runBacktest } from './engine/backtest.js'
import { runMandateBacktests } from './engine/mandateBacktest.js'
import { gradeBook } from './engine/grades.js'
import { buildRiskReport } from './engine/risk.js'
import {
  initBook,
  markStep,
  targetPositions,
  planOrders,
  execute,
  reconcile,
  serializeBook,
  deserializeBook,
} from './engine/oms.js'
import { fetchLiveMacro } from './live/fetchLive.js'
import { fetchFredMacro } from './live/fred.js'
import { conveneFirm } from './live/convene.js'
import { fetchEdgarFundamentals, staticBenchmarks, mergeBackendFundamentals } from './live/edgar.js'
import { fetchBackendState, fetchJournal, asOf } from './live/backend.js'
import { sleeveReturns } from './engine/proxies.js'
import { emptyPit, pitAppend, serializePit, deserializePit } from './engine/pit.js'
import { Plate, PLATES } from './components/art.jsx'
import {
  Masthead,
  SectionHead,
  ColumnDivider,
  MandateBanner,
  HardstopBanner,
  Footer,
} from './components/chrome.jsx'
import Compass from './components/Compass.jsx'
import Provenance from './components/Provenance.jsx'
import Gears from './components/Gears.jsx'
import Releases from './components/Releases.jsx'
import CycleGauge from './components/CycleGauge.jsx'
import AllWeather from './components/AllWeather.jsx'
import PureAlpha from './components/PureAlpha.jsx'
import Desks from './components/Desks.jsx'
import Origination from './components/Origination.jsx'
import Register from './components/Register.jsx'
import Allocation from './components/Allocation.jsx'
import MandateTrack from './components/MandateTrack.jsx'
import MonteCarlo from './components/MonteCarlo.jsx'
import Ledger from './components/Ledger.jsx'
import Firm from './components/Firm.jsx'
import Safeguards from './components/Safeguards.jsx'
import Tearsheet from './components/Tearsheet.jsx'
import Backtest from './components/Backtest.jsx'
import Execution from './components/Execution.jsx'

const PIT_KEY = 'apcap-pit-v1'
const BOOK_KEY = 'apcap-book-v1'

export default function App() {
  // One seeded generator for the life of the session: reproducible releases.
  // The state transition itself lives in src/engine/world.js — the single
  // advanceWorld shared with the server's canonical run (Invariant 2).
  const [engine] = useState(() => {
    const rng = mulberry32(SEED)
    const first = drawReading(rng, null)
    return { rng, world: advanceWorld(rng, seedWorld(), first) }
  })
  const [world, setWorld] = useState(engine.world)
  const [elected, setElected] = useState(() => new Set(DEFAULT_ELECTED))
  const [apiKey, setApiKey] = useState('')
  const [status, setStatus] = useState({ kind: 'idle', text: 'Feed: simulated · seeded generator' })
  const [fetching, setFetching] = useState(false)
  const [liveMemo, setLiveMemo] = useState(null)
  const [liveTape, setLiveTape] = useState(null)
  // The append-only point-in-time register persists across sessions.
  const [pit, setPit] = useState(() => {
    try {
      return deserializePit(window.localStorage.getItem(PIT_KEY))
    } catch {
      return emptyPit()
    }
  })
  const [convening, setConvening] = useState(false)
  const [firmStatus, setFirmStatus] = useState('')
  const [edgar, setEdgar] = useState(() => staticBenchmarks())
  const [edgarFetching, setEdgarFetching] = useState(false)
  const [edgarStatus, setEdgarStatus] = useState(null)
  // Latest real closes for the listed proxies, from the backend market-data
  // feed. Null until the backend has fetched at least one tick — the book
  // marks off the factor model until then.
  const [livePrices, setLivePrices] = useState(null)
  // The canonical book's daily journal (P&L, trades with reasons, sealed risk
  // statement) — null until the backend's first engine run lands.
  const [journal, setJournal] = useState(null)
  // The paper-trading book persists across sessions as the audit trail.
  const [book, setBook] = useState(() => {
    try {
      return deserializeBook(window.localStorage.getItem(BOOK_KEY))
    } catch {
      return initBook()
    }
  })

  useEffect(() => {
    try {
      window.localStorage.setItem(PIT_KEY, serializePit(pit))
    } catch {
      /* storage unavailable — the register lives in memory only */
    }
  }, [pit])

  const current = world.trail[world.trail.length - 1]
  const risk = riskOfRuin(current)
  const breached = risk > RUIN_CEILING

  // Derived Oaktree state — deterministic per cycle print, cheap to recompute.
  const scores = useMemo(() => proxyScores(world.cycle, world.cycleHist), [world.cycle, world.cycleHist])
  const composite = dialFrom(scores)
  const autoDial = world.autoDial
  const dial = world.dialOverride ?? autoDial
  // THE DECOUPLING: the dial's authority is scoped to the Cycle Credit
  // mandate. houseW is the firm five-sleeve view (Core fixed, credit
  // dial-scoped); creditW is the credit mandate's internal allocation.
  const houseW = useMemo(() => houseView(dial), [dial])
  const creditW = useMemo(() => creditWeightsFor(dial), [dial])
  const screen = useMemo(() => screenPerforming(world.cycle), [world.cycle])
  const triggers = useMemo(() => triggersFrom(world.cycle), [world.cycle])
  const deploy = deployAuthorized(triggers)
  // The proving ground runs once — fixed seed, identical report every session.
  const baseRates = useMemo(() => runBacktest(), [])
  // Standalone return tracks: each mandate's own engine, walked over the
  // same 22-year seeded path — Core is the real production book, Credit is
  // the real screen walked (see docs/CREDIT_BACKTEST_SCOPE.md for the gap
  // to a fully rigorous version).
  const mandateBT = useMemo(() => runMandateBacktests(), [])
  const templateMemo = useMemo(
    () =>
      memoFrom({
        releaseN: world.releaseN,
        dial,
        posture: postureOf(dial),
        cycle: world.cycle,
        screen,
        weights: houseW,
        deploy,
        baseRates,
      }),
    [world.releaseN, dial, world.cycle, screen, houseW, deploy, baseRates],
  )
  const memoIsLive = liveMemo !== null && liveMemo.releaseN === world.releaseN
  const memo = memoIsLive
    ? { number: templateMemo.number, quarter: templateMemo.quarter, title: liveMemo.title, paragraphs: liveMemo.paragraphs }
    : templateMemo

  // Cole's empire tracks the cycle: consummation in froth, arcadia at
  // mid-cycle, destruction in despair.
  const colePlate =
    dial < 35 ? PLATES.coleConsummation : dial < 65 ? PLATES.coleArcadian : PLATES.coleDestruction

  const electedAssets = useMemo(() => UNIVERSE.filter((a) => elected.has(a.id)), [elected])

  // Real risk math for the Core book: Ledoit–Wolf covariance, risk-parity
  // sizing at fixed 1.0× gross (the dial has no authority here — the
  // decoupling), CVaR, and the block-bootstrap replays for the elected book.
  const riskReport = useMemo(() => buildRiskReport(electedAssets), [electedAssets])

  // The Origination Desk re-ranks its docket from the same derived signals.
  const ideas = useMemo(
    () => bestIdeas({ g: current.g, i: current.i, dial, screen, deploy, cycle: world.cycle }),
    [current, dial, screen, deploy, world.cycle],
  )
  // The sourcing engine's full scan — catalysts + forced-seller detector +
  // the second-level gate — feeds the docket and drives the Sourcing panel.
  const sourcing = useMemo(() => scanCatalysts(world.cycle), [world.cycle])

  // The unified grade: one composite score + letter per holding, shared by
  // the Register, the docket, and the book.
  const grades = useMemo(() => gradeBook({ g: current.g, i: current.i, dial }), [current, dial])

  const simulate = () => {
    const reading = drawReading(engine.rng, current)
    setWorld((w) => advanceWorld(engine.rng, w, reading))
    setLiveMemo(null)
    setLiveTape(null)
    setFirmStatus('')
    setStatus({ kind: 'idle', text: 'Feed: simulated · seeded generator' })
  }

  // Live chain: FRED point-in-time first (exact prints, market-implied
  // priced-in), the web-search estimate second, simulation last. Every live
  // input lands in the append-only register with its knowable-at timestamp.
  const fetchLive = async () => {
    setFetching(true)
    setStatus({ kind: 'idle', text: 'Consulting the wire — FRED point-in-time fetch in progress…' })
    try {
      const { reading, tape, hyOasBp, prints, records } = await fetchFredMacro(apiKey.trim())
      setWorld((w) => advanceWorld(engine.rng, w, reading, hyOasBp))
      setPit((p) => pitAppend(p, records))
      setLiveTape(tape)
      setLiveMemo(null)
      setFirmStatus('')
      setStatus({
        kind: 'live',
        text: `Feed: live · FRED point-in-time · GDPNow ${prints.gdp_now}% · CPI ${prints.cpi_yoy}% vs ${prints.expinf_1y}% expected · HY OAS ${prints.hy_oas} bp`,
      })
      setFetching(false)
      return
    } catch (fredErr) {
      setStatus({ kind: 'idle', text: `FRED fetch failed (${fredErr.message}) — trying web search…` })
    }
    try {
      const { prints, reading } = await fetchLiveMacro(apiKey.trim())
      setWorld((w) => advanceWorld(engine.rng, w, reading, prints.hy_oas))
      const knownAt = new Date().toISOString()
      setPit((p) =>
        pitAppend(p, [
          { series: 'GDP_SAAR', label: 'Real GDP, SAAR (web search)', unit: '%', value: prints.gdp_saar, obsDate: knownAt.slice(0, 10), knownAt, source: 'web-search' },
          { series: 'CORE_CPI_YOY', label: 'Core CPI, YoY (web search)', unit: '%', value: prints.core_cpi_yoy, obsDate: knownAt.slice(0, 10), knownAt, source: 'web-search' },
          { series: 'POLICY_RATE', label: 'Policy Rate, Target (web search)', unit: '%', value: prints.policy_rate, obsDate: knownAt.slice(0, 10), knownAt, source: 'web-search' },
          { series: 'HY_OAS', label: 'HY OAS (web search)', unit: 'bp', value: prints.hy_oas, obsDate: knownAt.slice(0, 10), knownAt, source: 'web-search' },
        ]),
      )
      setLiveTape(null)
      setLiveMemo(null)
      setFirmStatus('')
      setStatus({
        kind: 'live',
        text: `Feed: live · web search (FRED unavailable) · GDP ${prints.gdp_saar}% · Core CPI ${prints.core_cpi_yoy}% · Policy ${prints.policy_rate}% · HY OAS ${prints.hy_oas} bp`,
      })
    } catch (err) {
      const reading = drawReading(engine.rng, current)
      setWorld((w) => advanceWorld(engine.rng, w, reading))
      setLiveTape(null)
      setStatus({
        kind: 'error',
        text: `Live fetch failed (${err.message}) — fell back to simulation`,
      })
    } finally {
      setFetching(false)
    }
  }

  // Phase 2 in miniature: the IC debate and the Memo written by a live model.
  const convene = async () => {
    setConvening(true)
    setFirmStatus('Convening — the committee is deliberating…')
    try {
      const res = await conveneFirm(apiKey.trim(), {
        release: world.releaseN,
        quarter: quarterLabel(world.releaseN),
        macro: { growth_surprise_sigma: current.g, inflation_surprise_sigma: current.i },
        cycle: world.cycle,
        dial,
        posture: postureOf(dial).word,
        sleeve_weights: weights,
        performing_desk: screen.map((r) => ({
          name: r.name,
          rating: r.rating,
          market_spread_bp: r.marketSpread,
          model_spread_bp: r.modelSpread,
          verdict: r.verdict,
        })),
        triggers_armed: triggers.filter((t) => t.armed).map((t) => t.name),
        dry_powder_deploy_authorized: deploy,
      })
      const ayes = res.votes.filter((v) => v.vote === 'aye').length
      const entry = {
        id: `live-${world.releaseN}-${Date.now()}`,
        n: world.releaseN,
        layer: 'L5',
        role: 'Investment Committee · Live',
        text: `Convened live — ${res.votes.map((v) => `${v.name}: ${v.vote} (“${v.reason}”)`).join(' · ')}. ${ayes}–${3 - ayes} ${ayes >= 2 ? 'PASSED' : 'REJECTED'}.`,
        tone: 'live',
      }
      setWorld((w) => ({ ...w, feed: [entry, ...w.feed].slice(0, FEED_LENGTH) }))
      setLiveMemo({ ...res, releaseN: world.releaseN })
      setFirmStatus('The firm convened live — committee reasoning in the feed, the memo below is the model’s own.')
    } catch (err) {
      setFirmStatus(`Convene failed (${err.message}) — the simulated firm stands.`)
    } finally {
      setConvening(false)
    }
  }

  useEffect(() => {
    try {
      window.localStorage.setItem(BOOK_KEY, serializeBook(book))
    } catch {
      /* storage unavailable — the paper book lives in memory only */
    }
  }, [book])

  // On load, read the canonical machine-state the scheduled backend ingest
  // persisted — live by default, no key, no button. Falls back silently to the
  // simulated feed if the backend isn't configured yet.
  useEffect(() => {
    let cancelled = false
    fetchJournal(10).then((entries) => {
      if (!cancelled && entries) setJournal(entries)
    })
    fetchBackendState().then((s) => {
      if (cancelled || !s) return
      if (s.prices) setLivePrices(s.prices)
      if (s.fundamentals) {
        setEdgar(mergeBackendFundamentals(s.fundamentals))
        setEdgarStatus({
          kind: 'live',
          text: `EDGAR: ${s.fundamentals.length} issuers from the scheduled backend feed.`,
        })
      }
      if (!s.reading) return
      setWorld((w) => advanceWorld(engine.rng, w, s.reading, s.hyOasBp ?? null))
      setLiveTape(s.tape ?? null)
      setStatus({
        kind: 'live',
        text: `Feed: live · FRED (auto) · as of ${asOf(s.knownAt)}${
          s.prints ? ` · CPI ${s.prints.cpi_yoy}% · HY OAS ${s.prints.hy_oas} bp` : ''
        }`,
      })
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Rebalance the paper book to the risk-parity target: mark to real closes
  // when the backend has fetched them, falling back to the factor model for
  // any sleeve without a live price (and entirely when the feed isn't
  // configured) — then plan orders and run each through pre-trade compliance.
  const rebalance = () => {
    if (!riskReport) return
    const weights = { ...riskReport.rp.weights }
    const real = sleeveReturns(livePrices)
    const modeled = markStep(current)
    const markReturns = real ? { ...modeled, ...real } : modeled
    setBook((b) => {
      const marked = reconcile(b, markReturns, `R${world.releaseN}`)
      const targets = targetPositions(marked, weights)
      const { book: next } = execute(marked, planOrders(marked, targets), { ruinBreached: breached })
      return next
    })
  }
  const resetBook = () => setBook(initBook())

  // Print only the tearsheet: stamp a class on <body> so the print stylesheet
  // hides the dashboard, then restore after the dialog closes. A plain Ctrl+P
  // still prints the full page.
  const printTearsheet = () => {
    document.body.classList.add('print-tearsheet')
    const cleanup = () => {
      document.body.classList.remove('print-tearsheet')
      window.removeEventListener('afterprint', cleanup)
    }
    window.addEventListener('afterprint', cleanup)
    window.print()
  }

  // Live credit fundamentals from SEC EDGAR XBRL; falls back to the offline
  // structural estimates on any failure, per issuer.
  const fetchEdgar = async () => {
    setEdgarFetching(true)
    setEdgarStatus({ kind: 'idle', text: 'Pulling companyfacts from data.sec.gov via web_fetch…' })
    try {
      const rows = await fetchEdgarFundamentals(apiKey.trim())
      setEdgar(rows)
      const live = rows.filter((r) => !r.error).length
      setEdgarStatus({
        kind: live ? 'live' : 'error',
        text: `EDGAR: ${live}/${rows.length} issuers parsed from live XBRL filings.`,
      })
    } catch (err) {
      setEdgar(staticBenchmarks())
      setEdgarStatus({ kind: 'error', text: `EDGAR pull failed (${err.message}) — showing offline estimates.` })
    } finally {
      setEdgarFetching(false)
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
        <button type="button" className="btn btn--outline" onClick={printTearsheet}>
          Print Tearsheet
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

      {/* ————— MANDATE I — the Oaktree engine, where the dial lives ————— */}
      <MandateBanner
        kicker="Mandate I · The Oaktree Engine"
        name="AP Cycle Credit"
        engine="Marks · Panossian · O’Leary — patient, concentrated, cycle-aware"
        note="Credit bought only when the price pays for the risk. Waits in dry powder; deploys into despair; priced by second-level thinking. The Aggressiveness Dial lives here — and its authority stops at this mandate’s border. Structured for qualified investors."
      />

      <section className="section">
        <SectionHead
          numeral="I"
          title="The Cycle"
          note="This mandate’s compass. You cannot predict the cycle; you can measure where you stand and calibrate offense against defense. The dial that settles here sizes only the credit book below it."
        />
        <Plate plate={colePlate} key={colePlate.title} />
        <CycleGauge
          scores={scores}
          composite={composite}
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
          numeral="II"
          title="The Credit Desks"
          note="Bottom-up selection: the performing desk earns carry through the gates; the opportunistic desk holds powder and waits for despair. If we avoid the losers, the winners take care of themselves."
        />
        <Desks
          screen={screen}
          triggers={triggers}
          deploy={deploy}
          cycle={world.cycle}
          powderPct={creditW[2] + (deploy ? 0 : creditW[1])}
          edgar={edgar}
          onFetchEdgar={fetchEdgar}
          edgarFetching={edgarFetching}
          edgarStatus={edgarStatus}
        />
      </section>

      <ColumnDivider />

      <section className="section">
        <SectionHead
          numeral="III"
          title="The Origination Desk"
          note="Where this mandate’s next dollar goes. Every signal the machine produces — regime, posture, carry, divergence — folded into one ranked docket of nominations. The desk proposes; the committee disposes."
        />
        <Origination ideas={ideas} sourcing={sourcing} />
      </section>

      {/* ————— MANDATE II — the Bridgewater engine, no dial input ————— */}
      <MandateBanner
        kicker="Mandate II · The Bridgewater Engine"
        name="AP All Weather Core"
        engine="Dalio’s machine — always invested, risk-balanced, fixed 1.0× gross"
        note="The steady book: harvest the risk premium in every economic season by balancing risk, not capital. No cycle timing, no leverage that breathes — the dial has no authority on this side of the wall. The decoupling is the design, not an accident."
      />

      <section className="section">
        <SectionHead
          numeral="IV"
          title="The Machine"
          note="This mandate’s diagnosis: growth against what was priced, inflation against what was priced. The compass reads the regime; the gears turn beneath it."
        />
        <Plate plate={PLATES.airpump} />
        <div className="grid-hero">
          <div className="panel">
            <Compass trail={world.trail} />
          </div>
          <Gears current={current} />
        </div>
        <Releases current={current} tape={liveTape} />
        <Provenance store={pit} />
      </section>

      <ColumnDivider />

      <section className="section">
        <SectionHead
          numeral="V"
          title="Beta — All Weather"
          note="The strategic book. Harvest the risk premium in every season by balancing risk, not capital."
        />
        <Plate plate={PLATES.poussin} />
        <AllWeather />
      </section>

      <ColumnDivider />

      <section className="section">
        <SectionHead
          numeral="VI"
          title="Alpha — Pure Alpha"
          note="The tactical book. Written principles, systematically applied — the same input always yields the same tilt."
        />
        <PureAlpha current={current} />
      </section>

      <ColumnDivider />

      <section className="section">
        <SectionHead
          numeral="VII"
          title="The Register"
          note="Seventeen liquid holdings, each carrying its unified grade — the one composite the whole firm quotes — ranked into five tiers, best to worst. Tick to elect into the Core’s working portfolio."
        />
        <Register current={current} elected={elected} grades={grades} onToggle={toggleAsset} />
      </section>

      <ColumnDivider />

      <section className="section">
        <SectionHead
          numeral="VIII"
          title="Monte Carlo Simulation"
          note="Four hundred paths of the elected Core book over ten years. The distribution is the forecast."
        />
        <MonteCarlo assets={electedAssets} risk={riskReport} />
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

      {/* ————— THE FIRM — shared infrastructure beneath both mandates ————— */}
      <MandateBanner
        kicker="The Firm"
        name="Shared Infrastructure"
        engine="One machine beneath both mandates"
        note="Capital governance, paper execution, the agent firm, and the proving ground. The wall between the mandates is enforced here — and the evidence for building it is published below."
      />

      <section className="section">
        <SectionHead
          numeral="X"
          title="The Two Mandates"
          note="Two engines, two jurisdictions, one fixed split of capital. Bridgewater runs the Core at constant gross; Oaktree runs Credit through the dial; neither reaches into the other’s book. The wall is the design — the proving ground priced the old coupling and the firm declined to keep paying for it."
        />
        <Allocation dial={dial} houseW={houseW} creditW={creditW} />

        <div className="grid-2" style={{ marginTop: 'var(--space-3)' }}>
          <MandateTrack
            id="core"
            title="AP All Weather Core — Standalone Track"
            engine="Real production engine"
            series={mandateBT.core}
            accent="var(--wedgwood)"
            note="Fixed risk-parity weights (no dial input) applied to the actual UNIVERSE factor returns — this is the same code that runs live, not a proxy."
          />
          <MandateTrack
            id="credit"
            title="AP Cycle Credit — Standalone Track"
            engine="Real screen, v1"
            series={mandateBT.credit}
            accent="var(--terracotta)"
            note="The real credit-screening engine, walked monthly — carry minus duration mark-to-market on the actual margin-of-safety book. Issuer fundamentals are a fixed snapshot re-screened each print, not a 22-year issuer history; scope for the fully rigorous version is in docs/CREDIT_BACKTEST_SCOPE.md."
          />
        </div>
      </section>

      <ColumnDivider />

      <section className="section">
        <SectionHead
          numeral="XI"
          title="The Execution Desk"
          note="The Core book, actually traded — on paper. Own capital, listed proxies, simulated fills; pre-trade compliance vetoes an order exactly as the risk agent vetoes a trade. Nothing here is real-money or outside-money automation, and nothing here is investment advice."
        />
        <Execution
          book={book}
          onRebalance={rebalance}
          onReset={resetBook}
          canTrade={!!riskReport}
          ruinBreached={breached}
          grades={grades}
          livePriceCount={livePrices ? Object.keys(sleeveReturns(livePrices) ?? {}).length : 0}
          journal={journal}
        />
      </section>

      <ColumnDivider />

      <section className="section">
        <SectionHead
          numeral="XII"
          title="The Firm"
          note="Every employee from intern to Co-CEO is an agent with a role, tools, and an artifact. Decisions flow up; nothing trades without passing each layer."
        />
        <Plate plate={PLATES.oath} />
        <Firm
          feed={world.feed}
          memo={memo}
          vetoCount={world.vetoCount}
          live={memoIsLive}
          onConvene={convene}
          convening={convening}
          firmStatus={firmStatus}
        />
      </section>

      <ColumnDivider />

      <section className="section">
        <SectionHead
          numeral="XIII"
          title="Safeguards"
          note="The machine assumes it will sometimes be wrong. The question is only how much that costs. The proving ground below is also the court record of the decoupling: the fixed-mix book beat the dial-coupled book on every axis."
        />
        <Plate plate={PLATES.socrates} />
        <Safeguards current={current} />
        <Backtest report={baseRates} />
      </section>

      <Footer />

      <Tearsheet
        current={current}
        dial={dial}
        posture={postureOf(dial)}
        regime={regimeOf(current)}
        book={book}
        grades={grades}
        baseRates={baseRates}
        memo={memo}
        weights={houseW}
      />
    </div>
  )
}
