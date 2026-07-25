// ————— The AP Credit Cycle Index (APCCI) —————
// A published, rules-based index of where the US credit cycle stands, from
// 0 (maximum froth — risk is priced for perfection) to 100 (maximum despair
// — the market pays you to take risk). Same orientation as the internal
// Aggressiveness Dial, but this is a DIFFERENT OBJECT and the difference is
// the entire point:
//
//   The dial (cycle.js) drives a simulated fund. Four of its seven proxies
//   (CCC share of issuance, cov-lite share, IPO/SPAC heat, lender behavior)
//   are SIMULATED values, and its percentile baseline is a seeded synthetic
//   climatology. That is fine for a simulation and disqualifying for a
//   published index: nobody outside this repo could reproduce a number.
//
//   This index takes ONLY inputs a stranger can download from FRED, and maps
//   them through FIXED, PUBLISHED anchor tables — not percentiles against a
//   generated history. Two people with the same FRED data and this document
//   must get the same number to the decimal, forever. That is the property
//   that makes an index citable rather than self-reported.
//
// Design rules, deliberately restrictive:
//   1. Every input is a public FRED series, daily or weekly.
//   2. Every mapping is piecewise-linear between published anchor points.
//      Anchors are calibrated to real historical episodes (2007 tights, the
//      GFC peak, March 2020, 2011 and 2016 stress) and are FROZEN. Changing
//      one changes history, so a change requires a new index version, not an
//      edit — see docs/APCCI_METHODOLOGY.md.
//   3. No lookahead, no revisions, no discretion, no seeded randomness.
//   4. A missing input does NOT produce a partial index. An index computed
//      from four of five components is a different index; publishing it
//      under the same name would be a silent methodology change. Incomplete
//      ⇒ no value published that day, and the reason is recorded.

export const INDEX_NAME = 'AP Credit Cycle Index'
export const INDEX_TICKER = 'APCCI'
export const INDEX_VERSION = '1.0.0'
// Values are on a fixed 0–100 scale, so there is no base value to rebase —
// the base date is simply the first day the index was published.
export const INDEX_BASE_DATE = '2026-07-22'

// ————— Component specification —————
// `anchors` are [rawValue, score] pairs, ascending in rawValue. Scores run
// 0 (froth) → 100 (despair). Sources are quoted in the units FRED publishes:
// OAS series in PERCENT (converted to bp at the parse site, see fred.js),
// NFCI as an index level, VIX in points.
export const COMPONENTS = [
  {
    key: 'hyOas',
    series: 'BAMLH0A0HYM2',
    label: 'US High Yield OAS',
    unit: 'bp',
    weight: 0.35,
    // 250bp ≈ the 2007 and 2021 all-time tights; ~475bp ≈ the long-run
    // median, deliberately placed at 50; ~1100bp ≈ the March 2020 peak;
    // ~2000bp ≈ the GFC extreme.
    anchors: [[250, 0], [325, 12], [400, 28], [475, 50], [600, 68], [800, 82], [1100, 93], [2000, 100]],
    plausible: [50, 3000],
  },
  {
    key: 'cccOas',
    series: 'BAMLH0A3HYC',
    label: 'CCC & Lower OAS',
    unit: 'bp',
    weight: 0.25,
    // The deep end of the market: where dispersion shows up first and where
    // distressed opportunity actually lives.
    anchors: [[450, 0], [650, 15], [800, 30], [1000, 50], [1400, 72], [1900, 87], [2600, 95], [4000, 100]],
    plausible: [100, 6000],
  },
  {
    key: 'igOas',
    series: 'BAMLC0A0CM',
    label: 'Investment Grade OAS',
    unit: 'bp',
    weight: 0.15,
    // Breadth: when IG widens materially, stress has stopped being a
    // high-yield story and become a system story.
    anchors: [[70, 0], [95, 15], [115, 30], [138, 50], [175, 70], [230, 85], [330, 95], [600, 100]],
    plausible: [20, 1000],
  },
  {
    key: 'nfci',
    series: 'NFCI',
    label: 'Chicago Fed National Financial Conditions',
    unit: 'index',
    weight: 0.15,
    // Constructed so 0 = average conditions since 1971; positive = tighter
    // than average. Weekly. Captures funding and leverage conditions the
    // spread series do not.
    anchors: [[-1.0, 0], [-0.7, 15], [-0.55, 30], [-0.4, 50], [-0.1, 68], [0.5, 85], [1.5, 95], [3, 100]],
    plausible: [-3, 6],
  },
  {
    key: 'vix',
    series: 'VIXCLS',
    label: 'CBOE Volatility Index',
    unit: 'points',
    weight: 0.1,
    // Risk appetite. Deliberately the smallest weight: VIX is an equity
    // measure and spikes on events that leave credit untouched.
    anchors: [[10, 0], [13, 15], [16, 30], [19, 50], [25, 70], [33, 85], [45, 95], [65, 100]],
    plausible: [5, 150],
  },
]

// Weights must sum to 1 — asserted at module load so a bad edit fails
// immediately rather than silently rescaling the index.
const WEIGHT_SUM = COMPONENTS.reduce((s, c) => s + c.weight, 0)
if (Math.abs(WEIGHT_SUM - 1) > 1e-9) {
  throw new Error(`APCCI component weights must sum to 1, got ${WEIGHT_SUM}`)
}

// Piecewise-linear interpolation across the anchor table, flat outside the
// ends. Flat (not extrapolated) on purpose: beyond the GFC peak the index is
// pinned at 100 rather than inventing a scale nobody has observed.
export function interpolate(anchors, raw) {
  if (raw <= anchors[0][0]) return anchors[0][1]
  const lastAnchor = anchors[anchors.length - 1]
  if (raw >= lastAnchor[0]) return lastAnchor[1]
  for (let k = 0; k < anchors.length - 1; k++) {
    const [x0, y0] = anchors[k]
    const [x1, y1] = anchors[k + 1]
    if (raw >= x0 && raw <= x1) return y0 + ((raw - x0) / (x1 - x0)) * (y1 - y0)
  }
  return lastAnchor[1] // unreachable for ascending anchors
}

// Score one component, or null when the input is absent or implausible.
// An implausible input is treated as MISSING, not clamped: a HY OAS of 8bp
// is a data error, and quietly scoring it 0 would publish a froth reading
// off a broken feed.
export function scoreComponent(spec, raw) {
  if (!Number.isFinite(raw)) return { ...spec, raw: null, score: null, reason: 'missing' }
  const [lo, hi] = spec.plausible
  if (raw < lo || raw > hi) return { ...spec, raw, score: null, reason: `implausible (outside ${lo}–${hi})` }
  return { ...spec, raw, score: +interpolate(spec.anchors, raw).toFixed(2), reason: null }
}

// Compute the index. `inputs` is { hyOas, cccOas, igOas, nfci, vix } in the
// units declared above. Returns the value plus every component's raw input
// and score, so a published value always ships with the arithmetic that
// produced it — a reader can check the number without rerunning the code.
export function computeIndex(inputs = {}) {
  const components = COMPONENTS.map((spec) => scoreComponent(spec, inputs[spec.key]))
  const missing = components.filter((c) => c.score === null)
  if (missing.length) {
    return {
      version: INDEX_VERSION,
      complete: false,
      value: null,
      missing: missing.map((c) => `${c.series}: ${c.reason}`),
      components,
    }
  }
  const value = components.reduce((s, c) => s + c.score * c.weight, 0)
  return {
    version: INDEX_VERSION,
    complete: true,
    value: +value.toFixed(2),
    missing: [],
    components: components.map(({ key, series, label, unit, weight, raw, score }) => ({
      key, series, label, unit, weight, raw, score,
      contribution: +(score * weight).toFixed(2),
    })),
  }
}

// The plain-language reading. Bands match the dial's postures so the index
// and the fund's own posture language stay consistent.
export function bandOf(value) {
  if (value == null) return { band: 'Unpublished', note: 'Incomplete inputs — no value published.' }
  if (value < 20) return { band: 'Extreme Froth', note: 'Risk is priced for perfection. Historically the worst time to add credit risk.' }
  if (value < 35) return { band: 'Froth', note: 'Spreads are tight and lenders are accommodating. Compensation for risk is below average.' }
  if (value < 65) return { band: 'Neutral', note: 'Mid-cycle. Neither fear nor greed is being paid for.' }
  if (value < 80) return { band: 'Stress', note: 'Compensation for risk is above average. Selective deployment.' }
  return { band: 'Despair', note: 'The market is paying well for risk. Historically the best time to add credit exposure.' }
}
