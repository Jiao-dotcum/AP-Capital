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
const { screenPerforming } = await eng('credit.js')
const { CYCLE0 } = await eng('cycle.js')
const { UNIVERSE } = await eng('assets.js')
const { gradeBook } = await eng('grades.js')
const { bestIdeas } = await eng('origination.js')
const { initBook, targetPositions, planOrders, execute } = await eng('oms.js')

check('engine modules import in bare Node (purity)', true)

const bt1 = runBacktest()
check('backtest deterministic', same(bt1, runBacktest()))
check('windowStats(10y) sane', (() => { const w = windowStats(bt1.series.managed, 10); return w.months === 120 && Number.isFinite(w.cagr) })())

const elected = UNIVERSE.filter((a) => ['usEq', 'ust10', 'tips', 'gold', 'gsci', 'cash'].includes(a.id))
const rr1 = buildRiskReport(elected, 50)
check('risk report deterministic', same(rr1, buildRiskReport(elected, 50)))
const shares = rr1.rp.seasons.map((s) => s.risk)
check('season risk shares equal', Math.max(...shares) - Math.min(...shares) <= 2, shares.join('/'))

const screen = screenPerforming(CYCLE0)
check('credit screen deterministic', same(screen, screenPerforming(CYCLE0)))
const bookW = screen.reduce((s, r) => s + r.weight, 0)
check('credit book non-empty at CYCLE0', bookW > 99 && bookW < 101, `weights sum ${bookW.toFixed(1)}%`)
check('credit book has PRIME/HOLD', screen.some((r) => r.verdict === 'PRIME' || r.verdict === 'HOLD'))
check('single-name cap respected', Math.max(...screen.map((r) => r.weight)) <= 22.01)

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
const { runEngineStep, verifyChain } = await import(join(ROOT, 'api/_lib/engine.js'))
const in1 = { reading: { g: 0.5, i: -0.3, source: 'live' }, hyOasBp: 350, knownAt: '2026-01-01T00:00:00.000Z', prices: null }
const run1 = runEngineStep(null, in1)
const run2 = runEngineStep(run1, { reading: { g: -0.2, i: 0.4, source: 'live' }, hyOasBp: 410, knownAt: '2026-01-02T00:00:00.000Z', prices: null })
check('canonical engine run deterministic', same(run1, runEngineStep(null, in1)))
check('canonical run rebalance (marks off par) zero vetoes', run1.decision.vetoed === 0 && run2.decision.vetoed === 0,
  `${run1.decision.vetoed}/${run2.decision.vetoed} vetoed`)
check('hash chain verifies; tampered NAV breaks it',
  verifyChain([run1, run2]).ok && !verifyChain([{ ...run1, nav: run1.nav + 1 }, run2]).ok)

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
