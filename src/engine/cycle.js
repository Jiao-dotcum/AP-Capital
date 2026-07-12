import { clamp, mulberry32 } from './prng.js'
import { drawReading } from './machine.js'

// ————— The Oaktree layer: cycle positioning —————
// You cannot predict the cycle, but you can measure where you stand in it.
// Seven proxies, each mapped to a 0–100 "despair score" (0 = froth, 100 =
// despair); their mean is the Aggressiveness Dial (0 = maximum defense,
// 100 = maximum offense). The dial sits ABOVE the macro compass: it scales
// exposure across the whole book.

export const CYCLE0 = {
  hySpread: 420, // bp, ICE-BofA-style HY OAS
  cccShare: 14, // % of new issuance rated CCC
  covLite: 82, // % of loan issuance cov-lite
  distressRatio: 6, // % of bonds trading > 1000bp
  fundFlows: 0.4, // $bn weekly into HY/loans (negative = outflows)
  ipoHeat: 55, // 0 dead — 100 euphoric
  lenderEase: 60, // 100 = "too much money chasing too few deals", 0 = rationing
}

// Evolve the credit cycle one release forward. Coupled to the macro reading:
// growth down or inflation up = credit stress = spreads wide, issuance frozen.
export function evolveCycle(rng, prev, reading) {
  const sh = () => (rng() + rng() + rng()) / 1.5 - 1
  const stress = -reading.g + 0.35 * reading.i
  const hySpread = clamp(
    prev.hySpread + 145 * stress + 85 * sh() + 0.1 * (CYCLE0.hySpread - prev.hySpread),
    220,
    1250,
  )
  const s = (hySpread - 220) / (1250 - 220) // 0 calm → 1 stressed
  return {
    hySpread: Math.round(hySpread),
    cccShare: +clamp(20 - 16 * s + 2.5 * sh(), 1, 24).toFixed(1),
    covLite: Math.round(clamp(92 - 55 * s + 5 * sh(), 20, 95)),
    distressRatio: +clamp(2 + 22 * s + 2.5 * sh(), 0.8, 30).toFixed(1),
    fundFlows: +clamp(2.2 - 7 * s + 1.2 * sh(), -8, 4).toFixed(1),
    ipoHeat: Math.round(clamp(85 - 80 * s + 10 * sh(), 2, 98)),
    lenderEase: Math.round(clamp(90 - 85 * s + 8 * sh(), 3, 97)),
  }
}

// Anchor the whole cycle to a live HY OAS print: the spread is real, the
// companion proxies are reconstructed from its implied stress level.
export function cycleFromSpread(hyOas) {
  const hySpread = Math.round(clamp(hyOas, 220, 1250))
  const s = (hySpread - 220) / (1250 - 220)
  return {
    hySpread,
    cccShare: +clamp(20 - 16 * s, 1, 24).toFixed(1),
    covLite: Math.round(clamp(92 - 55 * s, 20, 95)),
    distressRatio: +clamp(2 + 22 * s, 0.8, 30).toFixed(1),
    fundFlows: +clamp(2.2 - 7 * s, -8, 4).toFixed(1),
    ipoHeat: Math.round(clamp(85 - 80 * s, 2, 98)),
    lenderEase: Math.round(clamp(90 - 85 * s, 3, 97)),
  }
}

const flowWord = (f) => `${f >= 0 ? '+' : '−'}$${Math.abs(f).toFixed(1)}bn/wk`
const lenderWord = (e) =>
  e > 70 ? 'Money chasing deals' : e > 40 ? 'Selective' : e > 20 ? 'Tightening' : 'Rationing credit'

// ————— Percentile scoring against a rolling history —————
// A reading of "420 bp" means nothing on its own; what matters is where it
// sits in the distribution of everything the machine has seen. Each proxy is
// scored as its percentile in a ten-year seeded climatology (520 weekly
// prints evolved from the same cycle dynamics — reproducible by construction)
// plus every cycle state observed this session, oriented so 100 = despair.

const PROXY_FIELDS = ['hySpread', 'cccShare', 'covLite', 'distressRatio', 'fundFlows', 'ipoHeat', 'lenderEase']

// +1: higher reading = deeper despair; −1: lower reading = deeper despair.
const DESPAIR_DIR = {
  hySpread: +1,
  cccShare: -1,
  covLite: -1,
  distressRatio: +1,
  fundFlows: -1,
  ipoHeat: -1,
  lenderEase: -1,
}

export const CLIMATOLOGY_SEED = 20160705
export const CLIMATOLOGY_WEEKS = 520

export function buildClimatology(seed = CLIMATOLOGY_SEED, n = CLIMATOLOGY_WEEKS) {
  const rng = mulberry32(seed)
  const hist = Object.fromEntries(PROXY_FIELDS.map((f) => [f, []]))
  let c = CYCLE0
  let reading = null
  for (let k = 0; k < n; k++) {
    reading = drawReading(rng, reading)
    c = evolveCycle(rng, c, reading)
    for (const f of PROXY_FIELDS) hist[f].push(c[f])
  }
  return hist
}

const CLIMATOLOGY = buildClimatology()

// Midrank percentile: ties count half, so a flat history cannot pin a proxy
// to 0 or 100.
function pctRank(values, v) {
  let less = 0
  let eq = 0
  for (const x of values) {
    if (x < v) less += 1
    else if (x === v) eq += 1
  }
  return (100 * (less + 0.5 * eq)) / values.length
}

const despairPct = (field, v, extra) => {
  const values = extra.length
    ? [...CLIMATOLOGY[field], ...extra.map((c) => c[field])]
    : CLIMATOLOGY[field]
  const p = pctRank(values, v)
  return Math.round(DESPAIR_DIR[field] > 0 ? p : 100 - p)
}

// The rows CycleGauge renders. `history` is the session's past cycle states —
// the rolling extension of the climatology.
export function proxyScores(c, history = []) {
  const s = (field) => despairPct(field, c[field], history)
  return [
    { key: 'spread', label: 'HY Spread (OAS)', value: `${c.hySpread} bp`, froth: '< 300 bp', despair: '> 800 bp', score: s('hySpread') },
    { key: 'ccc', label: 'CCC Share of New Issuance', value: `${c.cccShare}%`, froth: 'Rising ≥ 20%', despair: 'Collapsed ≤ 3%', score: s('cccShare') },
    { key: 'covlite', label: 'Cov-Lite % of Loan Issuance', value: `${c.covLite}%`, froth: '> 85%', despair: 'Issuance frozen', score: s('covLite') },
    { key: 'distress', label: 'Distress Ratio (> 1000 bp)', value: `${c.distressRatio}%`, froth: '< 4%', despair: '> 15%', score: s('distressRatio') },
    { key: 'flows', label: 'HY / Loan Fund Flows', value: flowWord(c.fundFlows), froth: 'Heavy inflows', despair: 'Panic outflows', score: s('fundFlows') },
    { key: 'ipo', label: 'IPO · SPAC · Meme Heat', value: `${c.ipoHeat} / 100`, froth: 'Euphoric', despair: 'Dead', score: s('ipoHeat') },
    { key: 'lender', label: 'Lender Behavior', value: lenderWord(c.lenderEase), froth: 'Too much money', despair: 'Credit rationing', score: s('lenderEase') },
  ]
}

export const dialFrom = (scores) =>
  Math.round(scores.reduce((s, p) => s + p.score, 0) / scores.length)

// ————— Dial hysteresis —————
// The composite is noisy release to release; the book should not be. The
// dial follows the composite only when it has moved by at least the deadband
// — small wobbles are absorbed, regime shifts pass through.
export const DIAL_DEADBAND = 5

export const settleDial = (prevDial, composite) =>
  Math.abs(composite - prevDial) >= DIAL_DEADBAND ? composite : prevDial

export function postureOf(dial) {
  if (dial < 35) return { word: 'Defense', note: 'Froth: prices assume the best. Take what the market gives, keep powder dry.' }
  if (dial < 65) return { word: 'Neutral', note: 'Mid-cycle: neither fear nor greed is being paid for. Balance the book.' }
  return { word: 'Offense', note: 'Despair: the market pays you to take risk. Deploy powder into forced selling.' }
}

// ————— The five sleeves, now split across two mandates —————
// THE DECOUPLING: the firm runs two separate mandates with a FIXED capital
// split between them. The dial's authority is scoped to the credit mandate —
// it no longer moves capital out of the Core, and it no longer levers the
// Core's gross (see CORE_GROSS in risk.js). The 22-year walk-forward showed
// the old coupling (dial modulating the whole book) cost return, vol,
// drawdown, and Sharpe at once: the dial is a lagged echo of the same macro
// surprise the beta book already carries — one factor, counted twice.
export const SLEEVES = [
  { name: 'All Weather Beta', engine: 'Bridgewater', mandate: 'core' },
  { name: 'Pure Alpha Macro Tilts', engine: 'Bridgewater', mandate: 'core' },
  { name: 'Performing Credit', engine: 'Oaktree · Panossian', mandate: 'credit' },
  { name: 'Opportunistic / Distressed', engine: 'Oaktree · O’Leary', mandate: 'credit' },
  { name: 'Cash & T-Bills — Dry Powder', engine: 'Marks', mandate: 'credit' },
]

// Fixed split of firm capital between the two mandates (percent). Chosen as
// the neutral-dial anchor's implied split so the neutral posture is
// unchanged by the decoupling; each mandate is a separate product with its
// own investors in the long-term structure, so the split does not breathe
// with the cycle.
export const MANDATE_SPLIT = { core: 45, credit: 55 }

// Within the CORE mandate the two sleeves are fixed (no dial input at all):
// beta 35 / alpha 10 of firm capital, i.e. ~78/22 of the mandate.
export const CORE_SLEEVES = [35, 10]

// Anchor allocations at dial 20 / 50 / 80; linear interpolation between.
// Retained verbatim as the historical coupled policy: the backtest walks it
// (that evidence justified the decoupling), and the credit mandate's
// internal weights are derived from its last three columns below.
export const ANCHORS = [
  { d: 20, w: [40, 5, 20, 0, 35] },
  { d: 50, w: [35, 10, 30, 5, 20] },
  { d: 80, w: [25, 15, 30, 25, 5] },
]

export function weightsFor(dial) {
  const d = clamp(dial, ANCHORS[0].d, ANCHORS[ANCHORS.length - 1].d)
  let lo = ANCHORS[0]
  let hi = ANCHORS[ANCHORS.length - 1]
  for (let k = 0; k < ANCHORS.length - 1; k++) {
    if (d >= ANCHORS[k].d && d <= ANCHORS[k + 1].d) {
      lo = ANCHORS[k]
      hi = ANCHORS[k + 1]
      break
    }
  }
  const t = hi.d === lo.d ? 0 : (d - lo.d) / (hi.d - lo.d)
  const w = lo.w.map((v, k) => Math.round(v + (hi.w[k] - v) * t))
  // rounding drift lands in the cash sleeve so the book always sums to 100
  w[4] += 100 - w.reduce((s, v) => s + v, 0)
  return w
}

// The Cycle Credit mandate's internal allocation: [performing, distressed,
// dry powder] as % of the MANDATE (sums to 100). Derived by renormalizing
// the credit columns of the same anchors — one formula, one module — so the
// dial keeps exactly the posture curve it always had, scoped to the book it
// actually measures.
export function creditWeightsFor(dial) {
  const w = weightsFor(dial)
  const credit = [w[2], w[3], w[4]]
  const tot = credit.reduce((s, v) => s + v, 0)
  const out = credit.map((v) => Math.round((100 * v) / tot))
  out[2] += 100 - out.reduce((s, v) => s + v, 0) // drift lands in powder
  return out
}

// The firm-level five-sleeve view under the decoupled structure: Core fixed,
// credit sleeves = the mandate split × creditWeightsFor. Sums to 100. This
// is what the memo, the allocation panel, and the tearsheet quote.
export function houseView(dial) {
  const cw = creditWeightsFor(dial)
  const credit = cw.map((v) => Math.round((MANDATE_SPLIT.credit * v) / 100))
  const w = [...CORE_SLEEVES, ...credit]
  w[4] += 100 - w.reduce((s, v) => s + v, 0)
  return w
}

// ————— Dry-powder deployment triggers (the O'Leary function) —————
export function triggersFrom(c) {
  return [
    { name: 'Distress ratio > 10%', reading: `${c.distressRatio}%`, armed: c.distressRatio > 10 },
    { name: 'HY spread > 700 bp', reading: `${c.hySpread} bp`, armed: c.hySpread > 700 },
    { name: 'Forced sellers — outflows > $2.5bn/wk', reading: flowWord(c.fundFlows), armed: c.fundFlows < -2.5 },
  ]
}

export const deployAuthorized = (triggers) => triggers.filter((t) => t.armed).length >= 2
