import { clamp } from './prng.js'
import { UNIVERSE, CASH_RATE } from './assets.js'
import { secondLevelThesis, proxyVehicles } from './credit.js'

// ————— The Origination Desk —————
// Sourcing, mechanized: one composite conviction score per candidate, built
// only from signals the machine already produces — macro regime fit
// (Bridgewater), cycle-posture fit and carry (Marks), risk-adjusted premium,
// and, for credit names, consensus divergence (second-level thinking).
// The desk nominates; it never sizes. Every idea still passes the screens,
// the risk layer, and the committee before a dollar moves.

const WEIGHTS = { regime: 0.38, posture: 0.22, carry: 0.18, premium: 0.22 }

function macroThesis(a, g, i) {
  const geared = a.bG * g + a.bI * i
  const bits = []
  if (geared > 0.6)
    bits.push(
      `strongly geared to the current mix — growth ${g >= 0 ? 'beating' : 'missing'} and inflation ${i >= 0 ? 'above' : 'below'} what was priced`,
    )
  else if (geared > 0.15) bits.push('mildly helped by the current regime')
  else if (geared < -0.4) bits.push('fighting the regime; only the carry argues for it')
  if (a.carry >= 2.5) bits.push(`paid to wait at ${a.carry.toFixed(1)}%/yr carry`)
  if (a.vol <= 8) bits.push('ballast if the reading turns')
  if (!bits.length) bits.push('a diversifier — no directional claim')
  const s = bits.join('; ') + '.'
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export function bestIdeas({ g, i, dial, screen, deploy, cycle }) {
  const ideas = []

  // Macro sleeve candidates: the fifteen liquid holdings.
  for (const a of UNIVERSE) {
    const regime = clamp(50 + 18 * (a.bG * g + a.bI * i), 0, 100)
    const carry = clamp(((a.carry + 0.5) / 5) * 100, 0, 100)
    const premium = clamp(((a.er - CASH_RATE) / Math.max(a.vol, 1)) * 250, 0, 100)
    // Posture: at low dial the desk wants quiet assets, at high dial it is
    // paid to hold volatile ones. Distance between asset risk and appetite.
    const posture = clamp(100 - 100 * Math.abs(a.vol / 22 - dial / 100), 0, 100)
    const conviction = Math.round(
      WEIGHTS.regime * regime + WEIGHTS.posture * posture + WEIGHTS.carry * carry + WEIGHTS.premium * premium,
    )
    ideas.push({
      key: `mx-${a.id}`,
      name: a.name,
      type: 'Macro Sleeve',
      cls: a.cls,
      conviction,
      thesis: macroThesis(a, g, i),
      drivers: [
        { label: 'Regime', value: `${Math.round(regime)}` },
        { label: 'Posture', value: `${Math.round(posture)}` },
        { label: 'Carry', value: `${a.carry.toFixed(1)}%` },
        { label: 'ER−Cash', value: `${(a.er - CASH_RATE).toFixed(1)}%` },
      ],
    })
  }

  // Performing-credit nominations: only names that cleared every gate AND
  // where the model disagrees with consensus in our favor.
  for (const r of screen.filter((x) => x.verdict === 'PRIME')) {
    ideas.push({
      key: `pc-${r.id}`,
      name: `${r.name} ${r.rating}`,
      type: 'Performing Credit',
      cls: 'Credit',
      conviction: Math.round(clamp(52 + r.divergence / 3 + (r.mos - 0.55) * 60, 0, 100)),
      thesis: secondLevelThesis(r),
      drivers: [
        { label: 'Divergence', value: `+${r.divergence} bp` },
        { label: 'MoS', value: r.mos.toFixed(2) },
        { label: 'Spread/turn', value: `${r.spreadPerTurn} bp` },
      ],
    })
  }

  // Opportunistic nominations exist only when the triggers authorize powder.
  if (deploy) {
    const v = proxyVehicles(cycle)
    const cef = v.find((x) => x.name === 'Credit CEFs')
    const bdc = v.find((x) => x.name === 'BDC Basket')
    ideas.push(
      {
        key: 'op-cef',
        name: 'Credit CEFs at NAV Discount',
        type: 'Opportunistic',
        cls: 'Credit',
        conviction: Math.round(clamp(48 + dial * 0.45, 0, 100)),
        thesis: 'Forced sellers meet fixed vehicles: the NAV discount is the entry fee, refunded when the panic passes.',
        drivers: [
          { label: 'Discount', value: cef.value },
          { label: 'HY OAS', value: `${cycle.hySpread} bp` },
        ],
      },
      {
        key: 'op-bdc',
        name: 'BDC Basket Below Book',
        type: 'Opportunistic',
        cls: 'Credit',
        conviction: Math.round(clamp(44 + dial * 0.42, 0, 100)),
        thesis: 'Private loans marked slowly, wrappers repriced instantly — buy the wrapper when it trades under the loans.',
        drivers: [
          { label: 'Px/NAV', value: bdc.value },
          { label: 'HY OAS', value: `${cycle.hySpread} bp` },
        ],
      },
    )
  }

  return ideas.sort((a, b) => b.conviction - a.conviction).slice(0, 8)
}
