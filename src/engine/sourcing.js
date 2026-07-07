import { clamp } from './prng.js'

// ————— The Sourcing Engine (extends the Origination Desk) —————
// Where ideas come from before they are ranked. Three parts:
//   1. a catalyst scanner — mechanical special-situation detectors;
//   2. a forced-seller detector — who is selling for non-fundamental reasons;
//   3. a hard second-level gate — no lead reaches the docket without a written
//      answer to "what does consensus believe, why is it wrong, and what is
//      the kill condition?" A lead missing any of the three is HELD.
// Deterministic per cycle print (hash, not rng), like the credit desk.

function hash01(s) {
  let h = 2166136261
  for (const ch of s) {
    h ^= ch.charCodeAt(0)
    h = Math.imul(h, 16777619)
  }
  return ((h >>> 0) % 1000) / 1000
}

// ————— Forced-seller detector —————
// Flow capitulation measured in σ (weekly HY/loan fund flows against a ~$2.2bn
// weekly standard deviation), plus a margin-pressure proxy from the distress
// ratio and a deleveraging proxy from how fast spreads have run.
export function forcedSellers(cycle) {
  const flowSigma = +(-cycle.fundFlows / 2.2).toFixed(1) // outflows → positive σ
  const marginPressure = +clamp((cycle.distressRatio - 4) / 8, 0, 1).toFixed(2)
  const stress = +((cycle.hySpread - 220) / (1250 - 220)).toFixed(2)
  const capitulation = flowSigma > 2
  return {
    flowSigma,
    marginPressure,
    stress,
    capitulation,
    active: capitulation || marginPressure > 0.5,
    // 0–100 intensity: how hard the non-fundamental selling is right now.
    intensity: Math.round(clamp(28 * Math.max(0, flowSigma) + 45 * marginPressure + 30 * stress, 0, 100)),
  }
}

// ————— Catalyst universe —————
// Each carries the full second-level thesis. `fires(cycle)` gates whether the
// catalyst is live in the current environment; `forced` marks a forced-seller
// behind it. A lead with an empty consensus / whyWrong / kill is a raw lead —
// it will be HELD at the gate to demonstrate the discipline.
const CATALYSTS = [
  {
    id: 'fa', name: 'Fallen Angel — BBB→BB Crossover', type: 'Downgrade to Junk', sector: 'Industrials',
    fires: (c) => c.hySpread > 470, forced: true,
    consensus: 'Rating-triggered index and IG-mandate funds must sell the moment it leaves the index.',
    whyWrong: 'The sale is mechanical, not fundamental — the same bonds were investment grade a quarter ago and the business did not change overnight.',
    kill: 'A second downgrade into single-B territory, or interest coverage falling below 2×.',
  },
  {
    id: 'idx', name: 'S&P Index Deletion', type: 'Index Deletion', sector: 'Technology',
    fires: () => true, forced: true,
    consensus: 'Passive funds dump the name into the effective-date close at any price.',
    whyWrong: 'Deletion is market-cap mechanics, not deteriorating economics; the deletion discount has historically reverted over 20–60 sessions.',
    kill: 'Fundamentals confirm the market-cap decline — an earnings miss or guide-down, not just index math.',
  },
  {
    id: 'spin', name: 'Post-Spin Orphan Stub', type: 'Spinoff', sector: 'Consumer Discretionary',
    fires: (c) => c.ipoHeat > 42, forced: true,
    consensus: 'Holders of the parent sell the small unwanted stub indiscriminately — it is too small to keep.',
    whyWrong: 'The stub is orphaned and uncovered, and spun assets are frequently the higher-return half; indiscriminate selling is not a verdict on the business.',
    kill: 'The stub was loaded with stranded liabilities or pension/debt the parent shed onto it.',
  },
  {
    id: 'reorg', name: 'Fresh-Start Equity', type: 'Post-Bankruptcy Relisting', sector: 'Energy',
    fires: (c) => c.distressRatio > 5.5, forced: false,
    consensus: 'A just-relisted reorganized equity is un-ownable — no coverage, no index, no natural buyer.',
    whyWrong: 'Post-reorg balance sheets are clean by construction (the debt was discharged); the coverage vacuum is exactly why it is mispriced.',
    kill: 'The plan of reorganization re-levered into the same capital structure that caused the filing.',
  },
  {
    id: 'insider', name: 'Insider-Buying Cluster', type: 'Insider Cluster', sector: 'Financials',
    fires: (c) => c.hySpread > 520, forced: false,
    consensus: 'The stock is falling with its sector in the selloff; there is nothing specific to see.',
    whyWrong: 'Three officers bought in the open market this month — the people with the most information are adding, not trimming.',
    kill: 'The purchases were pre-scheduled 10b5-1 plans, or the cluster stops the following month.',
  },
  {
    id: 'cef', name: 'Credit CEF at Deep NAV Discount', type: 'CEF NAV Discount', sector: 'Credit',
    fires: (c) => c.hySpread > 500, forced: true,
    consensus: 'Retail holders flee the closed-end fund; the discount to NAV blows out past 12%.',
    whyWrong: 'The discount is a sentiment gauge, not a solvency one — the underlying loans keep paying while the wrapper is marked to fear.',
    kill: 'A real NAV markdown is coming — a leverage unwind or a distribution cut, not just a discount.',
  },
  // A raw momentum lead — deliberately missing its kill condition, so the
  // gate holds it out and the discipline is visible.
  {
    id: 'momo', name: 'Social-Momentum Small Cap', type: 'Retail Momentum', sector: 'Communications',
    fires: (c) => c.ipoHeat > 48, forced: false,
    consensus: 'The name is trending and volume is exploding; it "wants to go higher".',
    whyWrong: '',
    kill: '',
  },
]

// The hard second-level gate.
export function secondLevelGate(lead) {
  const missing = []
  if (!lead.consensus) missing.push('consensus view')
  if (!lead.whyWrong) missing.push('why-consensus-is-wrong')
  if (!lead.kill) missing.push('kill condition')
  return { pass: missing.length === 0, missing }
}

// Scan the catalyst universe against the current cycle, run the forced-seller
// detector, and grade every live lead at the second-level gate.
export function scanCatalysts(cycle) {
  const forced = forcedSellers(cycle)
  const leads = CATALYSTS.filter((c) => c.fires(cycle)).map((c) => {
    const gate = secondLevelGate(c)
    const wob = hash01(c.id + cycle.hySpread)
    // Conviction: contrarian trades earn more in stress and when a forced
    // seller is behind them; only meaningful for leads that pass the gate.
    const conviction = Math.round(
      clamp(
        40 +
          (c.forced ? 14 : 4) +
          0.28 * forced.intensity +
          18 * wob -
          (c.forced ? forced.stress * 6 : 0),
        0,
        100,
      ),
    )
    const discount = c.forced ? `${(6 + 16 * forced.stress + 6 * wob).toFixed(1)}% below fair` : '—'
    return {
      key: `cat-${c.id}`,
      id: c.id,
      name: c.name,
      type: c.type,
      sector: c.sector,
      forced: c.forced,
      consensus: c.consensus,
      whyWrong: c.whyWrong,
      kill: c.kill,
      gate: gate.pass ? 'PASS' : 'HELD',
      missing: gate.missing,
      conviction: gate.pass ? conviction : 0,
      discount,
    }
  })
  return { forced, leads }
}

// The gate-passing catalyst leads, formatted as docket ideas so they compete
// in the ranked convictions alongside macro sleeves and credit names.
export function sourcedIdeas(cycle) {
  const { forced, leads } = scanCatalysts(cycle)
  return leads
    .filter((l) => l.gate === 'PASS')
    .map((l) => ({
      key: l.key,
      name: l.name,
      type: `Special Situation · ${l.type}`,
      cls: l.sector,
      conviction: l.conviction,
      thesis: `Consensus: ${l.consensus} Why wrong: ${l.whyWrong} Kill: ${l.kill}`,
      drivers: [
        { label: l.forced ? 'Forced seller' : 'Non-forced', value: l.forced ? `${forced.intensity}/100` : 'signal' },
        { label: 'Discount', value: l.discount },
        { label: 'Flow σ', value: `${forced.flowSigma}` },
      ],
    }))
}
