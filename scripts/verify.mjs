#!/usr/bin/env node
// ————— The verification pipeline (see CLAUDE.md · quality bars) —————
// Engine determinism + purity + book sanity, then build, then a headless
// Chromium probe of the built page. Exits non-zero with a FAIL list.
// Usage: node scripts/verify.mjs [--skip-build] [--skip-browser]
import { execSync } from 'child_process'
import { createServer } from 'http'
import { readFileSync, existsSync } from 'fs'
import { join, extname, dirname } from 'path'
import { fileURLToPath } from 'url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SECTION_COUNT = 13 // update when adding/removing a dashboard section
const MARKERS = [
  'The Machine', 'The Cycle', 'Point-in-Time Register', 'The Origination Desk',
  'Sourcing Engine', 'Live Fundamentals — SEC EDGAR', 'ratings-transition matrix',
  'Risk Desk', 'Proving Ground', 'The Execution Desk', 'The Firm',
  'Believability standings', 'Merger Arbitrage',
  // The two-mandate structure (the decoupling)
  'AP Cycle Credit', 'AP All Weather Core', 'The Two Mandates',
]

const fails = []
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '  ✓' : '  ✗ FAIL'} ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) fails.push(name)
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

// ————— 1. Engine: purity, determinism, book sanity —————
console.log('— engine —')
const eng = async (m) => import(join(ROOT, 'src/engine', m))
const { runBacktest, windowStats } = await eng('backtest.js')
const { buildRiskReport } = await eng('risk.js')
const { screenPerforming, tradedIssuers, unleverAssetVol, realizedVolAnnual, buildRealIssuer, ISSUERS } = await eng('credit.js')
const { CYCLE0 } = await eng('cycle.js')
const { UNIVERSE, CASH_RATE } = await eng('assets.js')
const { gradeBook } = await eng('grades.js')
const { bestIdeas } = await eng('origination.js')
const { initBook, targetPositions, planOrders, execute } = await eng('oms.js')
const { runMandateBacktests } = await eng('mandateBacktest.js')

check('engine modules import in bare Node (purity)', true)

const bt1 = runBacktest()
check('backtest deterministic', same(bt1, runBacktest()))
check('windowStats(10y) sane', (() => { const w = windowStats(bt1.series.managed, 10); return w.months === 120 && Number.isFinite(w.cagr) })())

const elected = UNIVERSE.filter((a) => ['usEq', 'ust10', 'tips', 'gold', 'gsci', 'cash'].includes(a.id))
const rr1 = buildRiskReport(elected)
check('risk report deterministic', same(rr1, buildRiskReport(elected)))
check('Core gross fixed at 1.0 (the decoupling)', rr1.rp.gross === 1, `gross ${rr1.rp.gross}`)
const shares = rr1.rp.seasons.map((s) => s.risk)
check('season risk shares equal', Math.max(...shares) - Math.min(...shares) <= 2, shares.join('/'))

const screen = screenPerforming(CYCLE0)
check('credit screen deterministic', same(screen, screenPerforming(CYCLE0)))
const bookW = screen.reduce((s, r) => s + r.weight, 0)
check('credit book non-empty at CYCLE0', bookW > 99 && bookW < 101, `weights sum ${bookW.toFixed(1)}%`)
check('credit book has PRIME/HOLD', screen.some((r) => r.verdict === 'PRIME' || r.verdict === 'HOLD'))
check('single-name cap respected', Math.max(...screen.map((r) => r.weight)) <= 22.01)

// ————— The real trading desk (KMV unlevering, real issuers) —————
const kmv1 = unleverAssetVol(50e9, 0.35, 30e9)
check('KMV unlever deterministic', same(kmv1, unleverAssetVol(50e9, 0.35, 30e9)))
check('KMV asset vol < equity vol (levered claim)', kmv1.assetVol < 0.35 && kmv1.assetVol > 0, kmv1.assetVol.toFixed(3))
let kmvThrew = false
try { unleverAssetVol(0, 0.3, 10e9) } catch { kmvThrew = true }
check('KMV throws on non-positive inputs rather than returning garbage', kmvThrew)

const smoothCloses = Array.from({ length: 90 }, (_, i) => 100 * Math.pow(1.001, i))
check('realizedVolAnnual sane on a smooth series', realizedVolAnnual(smoothCloses) < 0.05)

const realFixture = buildRealIssuer(
  { ticker: 'TST', name: 'Test Issuer Co', sector: 'Industrials', rating: 'Ba1', recovery: 55 },
  { lev: 3.2, cov: 3.8, debt: 12e9, ebitda: 3.75e9 },
  { price: 45, sharesOut: 1.2e9, equityVolAnnual: 0.32 },
)
check('buildRealIssuer produces a valid ISSUERS-shaped row', realFixture.id === 'TST' && Number.isFinite(realFixture.mult) && Number.isFinite(realFixture.av) && realFixture.source === 'EDGAR+KMV')

// XBRL units are per-fact, not global: financials are us-gaap/USD but share
// counts are `shares`, and the authoritative current count is a dei
// cover-page fact. A USD-only lookup returns null for every filer, which
// would make buildRealIssuer throw "shares outstanding missing" for EVERY
// real issuer — the whole desk silently empty with everything configured.
const { latestSharesOutstanding, latestAnnual: latestAnnualUsd } = await import(join(ROOT, 'src/live/edgar.js'))
const unitFixture = { facts: {
  dei: { EntityCommonStockSharesOutstanding: { units: { shares: [{ form: '10-K', fp: 'FY', end: '2025-12-31', val: 4e9 }] } } },
  'us-gaap': { OperatingIncomeLoss: { units: { USD: [{ form: '10-K', fp: 'FY', end: '2025-12-31', val: 5e9 }] } } },
} }
check('shares outstanding read from the shares unit, not USD', latestSharesOutstanding(unitFixture) === 4e9)
check('USD financial lookups unaffected by the unit fix', latestAnnualUsd(unitFixture, ['OperatingIncomeLoss']) === 5e9)
// Real issuers REPLACE the simulated ten — a book that mixes measured and
// invented names can't be reasoned about. Fallback to ISSUERS only when no
// real name cleared.
const realOnly = tradedIssuers([realFixture])
check('tradedIssuers REPLACES the sims when real names exist', realOnly.length === 1 && realOnly[0].id === 'TST')
check('tradedIssuers(null/[]) falls back to the simulated ten', tradedIssuers(null) === ISSUERS && tradedIssuers([]) === ISSUERS)
const realScreen = screenPerforming(CYCLE0, realOnly)
check('real-only screen produces a verdict for every name', realScreen.length === 1 && typeof realScreen[0].verdict === 'string')
// A strict screen on a small real universe can leave most of the sleeve
// uninvested (the single-name cap has nowhere compliant to put the rest).
// That is allowed — but the idle share must earn cash, not zero.
check('screen weights may be under 100 on a small real universe (allowed)',
  realScreen.reduce((s, r) => s + r.weight, 0) <= 100.01)

const ctx = { g: 0.3, i: -0.2, dial: 50 }
const grades = gradeBook(ctx)
const ideas = bestIdeas({ ...ctx, screen, deploy: false, cycle: CYCLE0 })
const mismatch = ideas.filter((i) => i.key.startsWith('mx-') && i.conviction !== grades[i.key.slice(3)].score)
check('docket conviction === unified grade', mismatch.length === 0, mismatch.map((m) => m.key).join(','))

const b0 = initBook()
const { vetoed } = execute(b0, planOrders(b0, targetPositions(b0, rr1.rp.weights)), { ruinBreached: false })
check('routine OMS rebalance has zero vetoes', vetoed === 0, `${vetoed} vetoed`)

// The canonical server run (Phase 2): same advanceWorld as the browser, hash-
// chained records. run1 reconciles marks off par BEFORE rebalancing — the
// boundary case a fresh-book rebalance never exercises (a cap-clipped target
// plus 2dp order rounding must not trip a false preTrade veto).
const { runEngineStep, verifyChain, unchangedSinceRun, payloadOf, runHash } = await import(join(ROOT, 'api/_lib/engine.js'))
const in1 = { reading: { g: 0.5, i: -0.3, source: 'live' }, hyOasBp: 350, knownAt: '2026-01-01T00:00:00.000Z', prices: null }
const run1 = runEngineStep(null, in1)
const run2 = runEngineStep(run1, { reading: { g: -0.2, i: 0.4, source: 'live' }, hyOasBp: 410, knownAt: '2026-01-02T00:00:00.000Z', prices: null })
check('canonical engine run deterministic', same(run1, runEngineStep(null, in1)))
check('canonical run rebalance (marks off par) zero vetoes', run1.decision.vetoed === 0 && run2.decision.vetoed === 0,
  `${run1.decision.vetoed}/${run2.decision.vetoed} vetoed`)
check('hash chain verifies; tampered NAV breaks it',
  verifyChain([run1, run2]).ok && !verifyChain([{ ...run1, nav: run1.nav + 1 }, run2]).ok)
check('every order journaled with a sealed rationale', run1.orders.every((o) => o.rationale && o.grade?.letter))
check('credit paper book sealed in the run', run1.credit?.pnl?.navEnd > 0 && Array.isArray(run1.credit.orders))
check('credit book NAV carried run to run', run2.credit.pnl.navStart === run1.credit.pnl.navEnd)
check('decision records the PA overlay', Array.isArray(run1.decision.pureAlpha?.fired))
check('P&L identity: start + day + cost = end',
  Math.abs(run1.pnl.navStart + run1.pnl.dayPnl + run1.pnl.tradingCost - run1.pnl.navEnd) < 0.02)
check('risk statement sealed (CVaR, seasons, drawdown)',
  run1.risk.cvar95Dollar < 0 && run1.risk.seasons.length === 4 && 'currentPct' in run1.risk.drawdown)
check('no realIssuers = pre-real-desk behavior unchanged', run1.world.realIssuers.length === 0 && run1.decision.realIssuers.length === 0)

// The real trading desk end to end through runEngineStep: a real issuer
// actually reaches the credit book's orders, gets sealed in decision.realIssuers
// (hash-audited, not just carried state), survives a run where the fetch is
// skipped (realIssuers: null → carries forward), and can be explicitly
// cleared (realIssuers: [] → a real "nothing cleared" result, not a fetch gap).
const realFixtureRow = { id: 'TST', name: 'Test Issuer Co', sector: 'Industrials', rating: 'Ba1', recovery: 55, lev: 3.2, cov: 3.8, mult: 17.5, av: 0.221, price: 99, source: 'EDGAR+KMV', fiscalEnd: '2025-12-31', priceAsOf: '2026-07-10T00:00:00Z' }
const inR1 = { ...in1, realIssuers: [realFixtureRow] }
const runR1 = runEngineStep(null, inR1)
check('real-desk run deterministic', same(runR1, runEngineStep(null, inR1)))
check('real issuer sealed in decision.realIssuers', runR1.decision.realIssuers.length === 1 && runR1.decision.realIssuers[0].id === 'TST')
check('real issuer reaches the credit book orders', runR1.credit.orders.some((o) => o.id === 'TST'))
// Uninvested performing-sleeve capital is cash, not a zero-return hole —
// unreachable while the fixed ten sims always summed to 100, reachable the
// moment a real universe is screened strictly.
const { stepCreditBook } = await import(join(ROOT, 'api/_lib/creditBook.js'))
const thin = tradedIssuers([realFixture])
const t1 = stepCreditBook(null, { cycle: CYCLE0, dial: 50, dialOverride: null, issuers: thin })
const t2 = stepCreditBook(t1.book, { cycle: CYCLE0, dial: 50, dialOverride: null, issuers: thin })
const idleW = 100 - t1.book.prevRows.reduce((s, p) => s + Math.max(0, p.weight), 0)
check('idle sleeve capital earns cash, not zero',
  idleW <= 0 || t2.pnl.sleeves.performing.retPct > (idleW / 100) * (CASH_RATE / 12) * 0.5,
  `${idleW.toFixed(1)}% idle, sleeve ${t2.pnl.sleeves.performing.retPct}%`)
const runR2null = runEngineStep(runR1, { reading: run2.reading, hyOasBp: run2.hyOasBp, knownAt: '2026-01-02T00:00:00.000Z', prices: null, realIssuers: null })
check('null realIssuers carries the previous run forward', runR2null.world.realIssuers.length === 1)
const runR2clear = runEngineStep(runR1, { reading: run2.reading, hyOasBp: run2.hyOasBp, knownAt: '2026-01-02T00:00:00.000Z', prices: null, realIssuers: [] })
check('explicit [] clears the real book (no crash when a name exits the universe)', runR2clear.world.realIssuers.length === 0)

// ————— Chain gating: what counts as a new decision worth appending —————
// The chain must record a decision but ignore a mere re-invocation. Four
// triggers append (macro moved / override changed / traded universe changed /
// closes moved); re-curling identical inputs must not. Nulls mean "not
// fetched this run", never "changed to empty".
const pxA = { SPY: { close: 500, prevClose: 498, change: 0.4, asof: '2026-01-01' } }
const pxB = { SPY: { close: 505, prevClose: 500, change: 1.0, asof: '2026-01-02' } }
const gIn = { ...in1, prices: pxA, realIssuers: [realFixtureRow] }
const gRun = runEngineStep(null, gIn)
check('price fingerprint sealed in the decision', typeof gRun.decision.priceFingerprint === 'string' && gRun.decision.marksSource === 'live-closes')
check('identical repeat curl appends nothing', unchangedSinceRun(gRun, gIn) === true)
check('traded universe change appends (real desk activates same day)',
  unchangedSinceRun(gRun, { ...gIn, realIssuers: [] }) === false)
check('closes moving on a quiet-macro day appends (no hole in the journal)',
  unchangedSinceRun(gRun, { ...gIn, prices: pxB }) === false)
check('null prices/realIssuers are not treated as a change',
  unchangedSinceRun(gRun, { ...gIn, prices: null }) === true && unchangedSinceRun(gRun, { ...gIn, realIssuers: null }) === true)
// The trap this whole design avoids: a run sealed BEFORE priceFingerprint
// existed lacks the key, and its historical hash must still recompute.
const legacyRun = runEngineStep(null, { ...in1, prices: null, realIssuers: null })
delete legacyRun.decision.priceFingerprint
delete legacyRun.decision.marksSource
legacyRun.hash = runHash(null, payloadOf(legacyRun))
check('pre-fingerprint runs still verify (no retroactive chain break)', verifyChain([legacyRun]).ok)

// ————— External anchor: pure transforms + guarded degradation —————
// The network path is exercised against a stubbed fetch in the scratchpad
// (github.com is unreachable from this sandbox); what must hold here is that
// the log is append-only, idempotent on an unchanged head, and inert when
// unconfigured.
const anchor = await import(join(ROOT, 'api/_lib/anchor.js'))
const savedTok = process.env.GITHUB_TOKEN
const savedRepo = process.env.ANCHOR_REPO
delete process.env.GITHUB_TOKEN
delete process.env.ANCHOR_REPO
check('anchor no-ops when unconfigured', anchor.anchorConfigured() === false)
check('unconfigured anchor returns {configured:false}',
  same(await anchor.anchorChainHead({ seq: 1, hash: 'abc' }), { configured: false }))
if (savedTok !== undefined) process.env.GITHUB_TOKEN = savedTok
if (savedRepo !== undefined) process.env.ANCHOR_REPO = savedRepo
const aLog = '{"anchoredAt":"2026-07-20T00:00:00Z","seq":10,"head":"aaa"}\n'
const aRec = anchor.anchorRecord({ seq: 11, hash: 'bbb', knownAt: new Date('2026-07-21T00:00:00Z') }, new Date('2026-07-21T01:00:00Z'))
check('anchor record carries the head hash and ISO dates', aRec.head === 'bbb' && aRec.knownAt === '2026-07-21T00:00:00.000Z')
check('anchor log append is strictly additive',
  anchor.appendAnchorLine(aLog, aRec).startsWith(aLog) && anchor.appendAnchorLine(aLog, aRec).endsWith('\n'))
check('anchor reads back the last head (idempotency input)',
  anchor.lastAnchoredHead(anchor.appendAnchorLine(aLog, aRec)) === 'bbb')
check('anchor survives a corrupt trailing line', anchor.lastAnchoredHead(`${aLog}{oops`) === 'aaa')

const mbt1 = runMandateBacktests()
check('mandate backtests deterministic', same(mbt1, runMandateBacktests()))
check('mandate backtests: 264 months each, no NaN/Infinity',
  mbt1.core.length === 264 && mbt1.credit.length === 264 &&
  mbt1.core.every(Number.isFinite) && mbt1.credit.every(Number.isFinite))
// The full-rigor credit walk must produce real credit events (a 22-year HY
// path with zero defaults means the migration engine is broken — that
// exact bug shipped once: a NaN distance-to-default silently zeroed the
// default column), and the screen must show discrimination: names it
// REJECTED should default more often than names it HELD, or the gates
// measure nothing.
const dg = mbt1.creditDiag
check('credit walk realizes defaults', dg.defaults > 0, `${dg.defaults} defaults, ${dg.migrations} migrations`)
check('screen discriminates: rejected default rate ≥ held',
  dg.rejectedDefaults / dg.rejectedMonths >= dg.heldDefaults / dg.heldMonths,
  `held ${(dg.heldDefaults / dg.heldMonths * 1200).toFixed(1)}%/yr vs rejected ${(dg.rejectedDefaults / dg.rejectedMonths * 1200).toFixed(1)}%/yr`)

// The Pure Alpha overlay: vol-targeted, gross-capped, long-only after the
// clamp, and inert on a quiet (P·04) reading. It cleared a pre-registered
// 30-seed gate before being wired into the live book — do not re-tune its
// constants without re-running that gate (scratchpad pa-gate pattern).
const { pureAlphaTilt, coreTargets, PA_MAX_GROSS } = await eng('pureAlpha.js')
const paStag = pureAlphaTilt(-0.8, 0.9)
check('pure alpha deterministic, capped, directionally right',
  same(paStag, pureAlphaTilt(-0.8, 0.9)) && paStag.gross <= PA_MAX_GROSS + 1e-9 && paStag.tilt.gold > 0 && paStag.tilt.usEq < 0)
check('pure alpha inert on quiet reading', pureAlphaTilt(0.1, -0.1).gross === 0)
const ctv = coreTargets(rr1.rp.weights, paStag.tilt)
check('core targets long-only, gross ≤ 1',
  Object.values(ctv).every((w) => w >= 0) && Object.values(ctv).reduce((s, w) => s + w, 0) <= 1 + 1e-9)

const disclaimers = execSync(`grep -ri "not investment advice" ${join(ROOT, 'src')} | wc -l`).toString().trim()
check('disclaimers present (≥2)', Number(disclaimers) >= 2, `${disclaimers} found`)

// ————— 2. Build —————
if (!process.argv.includes('--skip-build')) {
  console.log('— build —')
  try {
    execSync('npm run build', { cwd: ROOT, stdio: 'pipe' })
    check('npm run build', true)
  } catch (e) {
    check('npm run build', false, String(e.stdout || e.message).slice(-400))
  }
}

// ————— 3. Headless browser (a green build does NOT mean the page renders) —————
if (!process.argv.includes('--skip-browser') && fails.length === 0) {
  console.log('— browser —')
  const { chromium } = await import('playwright-core')
  const dist = join(ROOT, 'dist')
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2' }
  const srv = createServer((q, s) => {
    let p = join(dist, q.url.split('?')[0])
    if (!existsSync(p) || p.endsWith('/')) p = join(dist, 'index.html')
    s.setHeader('content-type', types[extname(p)] || 'application/octet-stream')
    try { s.end(readFileSync(p)) } catch { s.statusCode = 404; s.end() }
  }).listen(4179)
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  const errors = []
  // ERR_TUNNEL / failed-resource = the Wikimedia art plates, blocked in
  // sandboxes and designed to withdraw — everything else is a real error.
  page.on('console', (m) => { if (m.type() === 'error' && !/ERR_TUNNEL|Failed to load resource/.test(m.text())) errors.push(m.text()) })
  page.on('pageerror', (e) => errors.push(`PAGEERROR ${e.message}`))
  await page.goto('http://localhost:4179', { waitUntil: 'networkidle', timeout: 30000 }).catch((e) => errors.push(`NAV ${e.message}`))
  await page.waitForTimeout(900)
  const sections = await page.evaluate(() => document.querySelectorAll('section').length)
  check(`sections === ${SECTION_COUNT}`, sections === SECTION_COUNT, `got ${sections}`)
  // innerText reflects text-transform:uppercase — always compare lowercased.
  const text = (await page.evaluate(() => document.body.innerText)).toLowerCase()
  const missing = MARKERS.filter((m) => !text.includes(m.toLowerCase()))
  check('all feature markers present', missing.length === 0, missing.join(', '))
  check('zero console/page errors', errors.length === 0, errors.slice(0, 3).join(' | '))
  // exercise the paper book: one rebalance must fill, not veto
  try {
    const btn = page.locator('button:has-text("Rebalance to Target")')
    await btn.scrollIntoViewIfNeeded()
    await btn.click()
    await page.waitForTimeout(400)
    const rows = await page.evaluate(() => {
      const t = [...document.querySelectorAll('table')].find((x) => /positions ledger/i.test(x.closest('.panel')?.innerText || ''))
      return t ? t.querySelectorAll('tbody tr').length : 0
    })
    check('rebalance builds positions', rows > 0, `${rows} rows`)
  } catch (e) {
    check('rebalance builds positions', false, e.message.slice(0, 120))
  }
  await browser.close()
  srv.close()
}

console.log(fails.length ? `\nFAILED: ${fails.length} check(s): ${fails.join('; ')}` : '\nAll checks passed.')
process.exit(fails.length ? 1 : 0)
