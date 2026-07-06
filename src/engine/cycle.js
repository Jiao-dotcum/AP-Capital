import { clamp } from './prng.js'

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

// Linear despair score: 0 at the froth value, 100 at the despair value.
const lin = (v, froth, despair) => Math.round(clamp(((v - froth) / (despair - froth)) * 100, 0, 100))

const flowWord = (f) => `${f >= 0 ? '+' : '−'}$${Math.abs(f).toFixed(1)}bn/wk`
const lenderWord = (e) =>
  e > 70 ? 'Money chasing deals' : e > 40 ? 'Selective' : e > 20 ? 'Tightening' : 'Rationing credit'

export function proxyScores(c) {
  return [
    { key: 'spread', label: 'HY Spread (OAS)', value: `${c.hySpread} bp`, froth: '< 300 bp', despair: '> 800 bp', score: lin(c.hySpread, 300, 800) },
    { key: 'ccc', label: 'CCC Share of New Issuance', value: `${c.cccShare}%`, froth: 'Rising ≥ 20%', despair: 'Collapsed ≤ 3%', score: lin(c.cccShare, 20, 3) },
    { key: 'covlite', label: 'Cov-Lite % of Loan Issuance', value: `${c.covLite}%`, froth: '> 85%', despair: 'Issuance frozen', score: lin(c.covLite, 85, 30) },
    { key: 'distress', label: 'Distress Ratio (> 1000 bp)', value: `${c.distressRatio}%`, froth: '< 4%', despair: '> 15%', score: lin(c.distressRatio, 4, 15) },
    { key: 'flows', label: 'HY / Loan Fund Flows', value: flowWord(c.fundFlows), froth: 'Heavy inflows', despair: 'Panic outflows', score: lin(c.fundFlows, 2, -5) },
    { key: 'ipo', label: 'IPO · SPAC · Meme Heat', value: `${c.ipoHeat} / 100`, froth: 'Euphoric', despair: 'Dead', score: lin(c.ipoHeat, 90, 10) },
    { key: 'lender', label: 'Lender Behavior', value: lenderWord(c.lenderEase), froth: 'Too much money', despair: 'Credit rationing', score: lin(c.lenderEase, 90, 10) },
  ]
}

export const dialFrom = (scores) =>
  Math.round(scores.reduce((s, p) => s + p.score, 0) / scores.length)

export function postureOf(dial) {
  if (dial < 35) return { word: 'Defense', note: 'Froth: prices assume the best. Take what the market gives, keep powder dry.' }
  if (dial < 65) return { word: 'Neutral', note: 'Mid-cycle: neither fear nor greed is being paid for. Balance the book.' }
  return { word: 'Offense', note: 'Despair: the market pays you to take risk. Deploy powder into forced selling.' }
}

// ————— The unified book: five sleeves modulated by the dial —————
export const SLEEVES = [
  { name: 'All Weather Beta', engine: 'Bridgewater' },
  { name: 'Pure Alpha Macro Tilts', engine: 'Bridgewater' },
  { name: 'Performing Credit', engine: 'Oaktree · Panossian' },
  { name: 'Opportunistic / Distressed', engine: 'Oaktree · O’Leary' },
  { name: 'Cash & T-Bills — Dry Powder', engine: 'Marks' },
]

// Anchor allocations at dial 20 / 50 / 80; linear interpolation between.
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

// ————— Dry-powder deployment triggers (the O'Leary function) —————
export function triggersFrom(c) {
  return [
    { name: 'Distress ratio > 10%', reading: `${c.distressRatio}%`, armed: c.distressRatio > 10 },
    { name: 'HY spread > 700 bp', reading: `${c.hySpread} bp`, armed: c.hySpread > 700 },
    { name: 'Forced sellers — outflows > $2.5bn/wk', reading: flowWord(c.fundFlows), armed: c.fundFlows < -2.5 },
  ]
}

export const deployAuthorized = (triggers) => triggers.filter((t) => t.armed).length >= 2
