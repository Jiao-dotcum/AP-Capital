import { secondLevelThesis } from './credit.js'
import { regimeOf, RUIN_CEILING } from './machine.js'
import { SLEEVES } from './cycle.js'
import { runBacktest } from './backtest.js'

// ————— The firm as an agent hierarchy —————
// Every layer owns a real artifact, runs a real check, and carries a
// track-record score — its believability, measured on the walk-forward
// proving ground. Nothing trades without passing each layer, and each agent's
// vote is weighted by how often it has been right.
export const LAYERS = [
  { id: 'L0', role: 'Interns — Data Agents', duty: 'Pull FRED, EDGAR, flows, transcripts on schedule; clean into the database.',
    artifact: 'The point-in-time register', check: 'Every input stamped with when it was knowable — no lookahead.' },
  { id: 'L1', role: 'Analysts — Screening Agents', duty: 'Run credit screens, flag anomalies, draft one-page tickers.',
    artifact: 'The screen sheet', check: 'Coverage, distance-to-default, spread-per-turn, margin-of-safety gates.' },
  { id: 'L2', role: 'Senior Analysts — Memo Agents', duty: 'Full credit memos: capital structure, covenants, downside case, second-level thesis.',
    artifact: 'The credit memo', check: 'Market spread vs expected-loss model — where consensus is wrong, and why.' },
  { id: 'L3', role: 'Desk PMs — Two Agents', duty: 'Performing Credit builds the carry book; Opportunistic manages dry powder.',
    artifact: 'The carry book & powder ledger', check: 'Margin-of-safety sizing; deploy only when ≥ 2 triggers arm.' },
  { id: 'L4', role: 'Risk & Compliance — Adversarial Agent', duty: 'Margin-of-safety gate, concentration limits, 2.5% ruin ceiling. Holds VETO.',
    artifact: 'The error log', check: 'Concentration caps and the ruin ceiling, enforced at the order gate.' },
  { id: 'L5', role: 'Investment Committee — Debate Agents', duty: 'Three deliberately different priors argue each proposal; believability-weighted plus risk non-veto.',
    artifact: 'The debate minutes', check: 'Each prior votes; votes weighted by past hit rate.' },
  { id: 'L6', role: 'Co-CEOs — Panossian & O’Leary Agents', duty: 'Set desk strategy and the dial; joint sign-off on allocation shifts > 5pp. You ratify.',
    artifact: 'The dial & allocation', check: 'Joint sign-off above a 5pp sleeve move; the dial posture call.' },
  { id: 'L7', role: 'The Memo — Marks Agent', duty: 'Quarterly synthesis: where we stand, what the crowd believes, where we differ.',
    artifact: 'The quarterly memo', check: 'Every claim logged against realized base rates; divergence triggers a rewrite.' },
]

// ————— Believability: track records from the proving ground —————
// The base rates are static (fixed-seed walk-forward), so compute once.
let _base = null
const base = () => (_base ??= runBacktest())

const avg = (xs) => (xs.length ? Math.round(xs.reduce((s, x) => s + x, 0) / xs.length) : 50)

// Each IC prior's believability is the base rate that measures whether its
// worldview actually pays: the perma-bear on defense-precedes-widening, the
// macro-first agent on regime calls, the bottom-up agent on the principles.
export function believability() {
  const b = base()
  const regimeAvg = avg(b.regimes.map((r) => r.hitRate ?? 50))
  const principleAvg = avg(b.principles.filter((p) => p.hitRate != null).map((p) => p.hitRate))
  return {
    Cassandra: b.dial.defense.hitRate ?? 50,
    Quadratus: regimeAvg,
    Fossor: principleAvg,
  }
}

// The eight layers with a track-record score attached, for the standings.
export function firmStandings() {
  const b = base()
  const bel = believability()
  const regimeAvg = avg(b.regimes.map((r) => r.hitRate ?? 50))
  const principleAvg = avg(b.principles.filter((p) => p.hitRate != null).map((p) => p.hitRate))
  const score = {
    L0: 99, // the register is lookahead-proof by construction
    L1: principleAvg,
    L2: avg([bel.Fossor, principleAvg]),
    L3: regimeAvg,
    L4: Math.max(35, Math.round(100 - 2.2 * b.book.maxDD)), // shallower drawdowns = more believable risk agent
    L5: avg([bel.Cassandra, bel.Quadratus, bel.Fossor]),
    L6: b.dial.offense.hitRate ?? 50,
    L7: regimeAvg,
  }
  return LAYERS.map((l) => ({ ...l, score: score[l.id] })).sort((x, y) => y.score - x.score)
}

const fmtSig = (v) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(2)}σ`
const fmtBp = (v) => `${v >= 0 ? '+' : '−'}${Math.abs(v)} bp`

// One release = one pass through the hierarchy. Returns feed entries,
// newest first, each { id, layer, role, text, tone } with tone in
// info | pass | veto.
export function buildFeed(ctx) {
  const { n, reading, cycle, dial, weights, prevWeights, screen, triggers, deploy, risk } = ctx
  const entries = []
  const push = (layer, role, text, tone = 'info') =>
    entries.push({ id: `${n}-${entries.length}`, n, layer, role, text, tone })

  // L0 — interns pull the tape
  push(
    'L0',
    'Intern · Data',
    `Pulled the tape — HY OAS ${cycle.hySpread} bp · distress ratio ${cycle.distressRatio}% · flows ${cycle.fundFlows >= 0 ? '+' : '−'}$${Math.abs(cycle.fundFlows).toFixed(1)}bn/wk · growth surprise ${fmtSig(reading.g)} · inflation ${fmtSig(reading.i)}.`,
  )

  // L1 — analysts flag the widest divergence
  const passers = screen.filter((r) => r.weight > 0)
  const flagged = [...screen].sort((a, b) => Math.abs(b.divergence) - Math.abs(a.divergence))[0]
  push(
    'L1',
    'Analyst · Screens',
    `Screens run: ${passers.length}/${screen.length} names pass the gates. Flagged ${flagged.name} — market ${flagged.marketSpread} bp vs model ${flagged.modelSpread} bp (${fmtBp(flagged.divergence)}).`,
  )

  // L1b — the alternatives analyst covers the volatility & merger-arb sleeves,
  // whose net stance the dial directs: short vol in froth, long vol in despair.
  const volStance =
    dial < 35
      ? 'short vol — sell premium and hold merger-arb carry; froth pays the seller'
      : dial >= 65
        ? 'long vol — own convexity into the despair, where the crash pays the hedge'
        : 'vol-neutral — arb carry with a convexity tail, waiting for the dial to commit'
  push('L1', 'Analyst · Volatility & Arb', `Alternatives sleeves at dial ${dial}: ${volStance}.`)

  // L2 — senior analyst writes the memo on the flagged name
  push(
    'L2',
    'Senior Analyst · Memo',
    `Memo, ${flagged.name} (${flagged.rating}): price ${flagged.price} vs ${flagged.recovery} stressed recovery — downside ${flagged.mos >= 0.7 ? 'returns' : flagged.mos >= 0.55 ? 'substantially returns' : 'IMPAIRS'} capital. Second-level: ${secondLevelThesis(flagged)}`,
  )

  // L3 — the two desks propose
  const top = passers.sort((a, b) => b.weight - a.weight)[0]
  push(
    'L3',
    'PM · Performing Credit',
    top
      ? `Proposes a ${passers.length}-name carry book, sized by margin of safety — top weight ${top.name} at ${top.weight.toFixed(1)}%. Spread-per-turn floor held at 90 bp.`
      : 'No names clear the gates. The desk proposes nothing — an empty book is a position.',
  )
  const armed = triggers.filter((t) => t.armed)
  push(
    'L3',
    'PM · Opportunistic',
    deploy
      ? `${armed.length}/3 distress triggers armed (${armed.map((t) => t.name).join('; ')}). Requests dry-powder deployment into listed proxies — HY ETF, loan ETF, CLO BB debt, BDC and CEF discounts.`
      : `${armed.length}/3 triggers armed. The desk stands idle and the system tolerates the idleness — reaching for yield is refused by construction.`,
    deploy ? 'pass' : 'info',
  )

  // L4 — the adversarial risk agent
  const rejected = screen.filter((r) => r.verdict === 'REJECT' || r.verdict === 'AVOID')
  if (risk.breached) {
    push(
      'L4',
      'Risk & Compliance',
      `VETO — tail-loss probability ${(risk.value * 100).toFixed(2)}% exceeds the ${(RUIN_CEILING * 100).toFixed(1)}% ceiling. Gross scaled to 60%, hedges executed, manual override refused. Logged to the Error Log.`,
      'veto',
    )
  } else {
    push(
      'L4',
      'Risk & Compliance',
      `No portfolio veto. ${rejected.length} name${rejected.length === 1 ? '' : 's'} refused at the gates (${rejected.slice(0, 2).map((r) => r.name).join('; ')}${rejected.length > 2 ? '; …' : ''}). Margin-of-safety holds for every sized position.`,
      'pass',
    )
  }

  // L5 — the investment committee debates, votes weighted by believability
  const regime = regimeOf(reading)
  const bestDiv = screen.length ? Math.max(...screen.map((r) => r.divergence)) : 0
  const bel = believability()
  const votes = [
    { name: 'Cassandra (perma-bear)', w: bel.Cassandra, yes: dial >= 55 || weights[4] > prevWeights[4] },
    { name: 'Quadratus (macro-first)', w: bel.Quadratus, yes: reading.g > -0.3 || regime.key === 'falling-falling' },
    { name: 'Fossor (bottom-up-first)', w: bel.Fossor, yes: bestDiv > 60 },
  ]
  const wAye = votes.filter((v) => v.yes).reduce((s, v) => s + v.w, 0)
  const wTot = votes.reduce((s, v) => s + v.w, 0)
  const pct = Math.round((100 * wAye) / wTot)
  const passed = pct > 50 && !risk.breached
  push(
    'L5',
    'Investment Committee',
    `Debate — ${votes.map((v) => `${v.name} [bel ${v.w}]: ${v.yes ? 'aye' : 'nay'}`).join(' · ')}. Believability-weighted ${pct}% aye — ${passed ? 'PASSED' : risk.breached ? 'moot; the risk veto stands' : 'REJECTED'}.`,
    passed ? 'pass' : 'veto',
  )

  // L6 — Co-CEO sign-off on big allocation moves
  const maxShift = Math.max(...weights.map((w, k) => Math.abs(w - prevWeights[k])))
  const shiftIdx = weights.findIndex((w, k) => Math.abs(w - prevWeights[k]) === maxShift)
  if (maxShift > 5) {
    push(
      'L6',
      'Co-CEOs · Joint Sign-Off',
      `${SLEEVES[shiftIdx].name} moves ${maxShift}pp — above the 5pp threshold. Panossian and O’Leary jointly sign; the dial stands at ${dial}. Recommendation forwarded for human ratification.`,
      'pass',
    )
  } else {
    push('L6', 'Co-CEOs', `Allocation drift ≤ 5pp — no joint sign-off required. Dial holds at ${dial}.`)
  }

  return entries.reverse() // newest first when prepended
}

// ————— Layer 7: the quarterly Memo (the Marks function) —————
const QUARTERS = ['Q3 2026', 'Q4 2026', 'Q1 2027', 'Q2 2027', 'Q3 2027', 'Q4 2027', 'Q1 2028', 'Q2 2028']
export const quarterLabel = (releaseN) => QUARTERS[Math.min(QUARTERS.length - 1, Math.floor((releaseN - 1) / 3))]

// The believability standings, one line for the Memo.
function standingsLine() {
  const s = firmStandings()
  const top = s[0]
  const bottom = s[s.length - 1]
  return (
    `Believability standings: the ${top.role.split(' — ')[0]} lead at ${top.score}% on the record, ` +
    `the ${bottom.role.split(' — ')[0]} trail at ${bottom.score}% — and each IC vote is weighted accordingly, ` +
    `so the agents that have been right count for more than the agents that have been loud.`
  )
}

export function memoFrom({ releaseN, dial, posture, cycle, screen, weights, deploy, baseRates = null }) {
  const cheap = [...screen].sort((a, b) => b.divergence - a.divergence)[0]
  const rich = [...screen].sort((a, b) => a.divergence - b.divergence)[0]
  const no = Math.floor((releaseN - 1) / 3) + 1
  // The Memo quotes the proving ground: claims are made against measured
  // base rates, not against memory.
  let rates = null
  if (baseRates) {
    const fired = [...baseRates.principles].filter((p) => p.hitRate !== null).sort((a, b) => b.fires - a.fires)
    const [p1, p2] = fired
    rates =
      `The base rates: across a ${baseRates.years}-year walk-forward — rules frozen at T, graded at T+1 — ` +
      `${p1.id} fired ${p1.fires} times and paid in ${p1.hitRate}% of the following months; ${p2.id} in ${p2.hitRate}% of ${p2.fires}. ` +
      `Offense at the dial preceded spread tightening ${baseRates.dial.offense.hitRate ?? '—'}% of the time, defense preceded widening ${baseRates.dial.defense.hitRate ?? '—'}%, ` +
      `and the deadband cut turnover from ${baseRates.turnover.unsettled}pp to ${baseRates.turnover.settled}pp per release. ` +
      `A principle that cannot beat its base rate is rewritten, not defended.`
  }
  return {
    number: no,
    quarter: quarterLabel(releaseN),
    title: dial < 35 ? 'On the Temptation to Reach' : dial < 65 ? 'The Middle of the Road' : 'Getting Paid to Be Brave',
    paragraphs: [
      `Where we stand: the pendulum reads ${dial} of 100 — ${posture.word.toLowerCase()}. High yield pays ${cycle.hySpread} basis points over Treasuries, the distress ratio sits at ${cycle.distressRatio}%, and lenders are ${cycle.lenderEase > 60 ? 'competing to make loans, which is precisely when loans should not be made' : cycle.lenderEase > 30 ? 'growing selective' : 'rationing credit, which is precisely when it should be extended'}. We cannot predict where the cycle goes next; we can know where we are in it, and calibrate.`,
      `What the crowd believes, and where we differ: consensus is most wrong on ${cheap.name}, where the market demands ${cheap.marketSpread} bp against our ${cheap.modelSpread} bp of modeled risk — first-level thinking sees the headline, second-level thinking sees the recovery value under the price. Conversely the crowd adores ${rich.name}; we decline to pay for the admiration. Alpha is permitted only where we disagree with the consensus and can articulate why the consensus is wrong.`,
      `Posture: ${weights[0]}% risk-balanced beta, ${weights[2]}% performing credit earning carry, ${weights[3]}% opportunistic${deploy ? ' — powder is being deployed into forced selling' : ' held as intention rather than position'}, and ${weights[4]}% dry powder. ${dial < 35 ? 'If we avoid the losers, the winners will take care of themselves.' : dial < 65 ? 'Neither maximum defense nor maximum offense is being paid for today; humility is a position too.' : 'The bargains exist because everyone is selling; our job is merely to be solvent and present.'}`,
      ...(rates ? [rates] : []),
      standingsLine(),
      'You cannot predict. You can prepare. — The Memo is the system’s self-audit: every claim above is logged against realized outcomes, and systematic divergence triggers a principle rewrite.',
    ],
  }
}
