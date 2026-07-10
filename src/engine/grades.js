import { clamp } from './prng.js'
import { UNIVERSE, CASH_RATE } from './assets.js'

// ————— The unified grade —————
// One number, one letter, everywhere. The composite conviction score merges
// every signal the machine produces — macro regime fit, cycle-posture fit,
// carry, risk-adjusted premium, and (for credit names) consensus divergence
// and margin of safety — and maps it onto a letter grade. The Origination
// docket, the Register, and the Execution book all quote THIS number, so a
// holding cannot be an A in one section and a C in another.

export const MACRO_WEIGHTS = { regime: 0.38, posture: 0.22, carry: 0.18, premium: 0.22 }

// Component scores, each 0–100.
export function macroComponents(a, g, i, dial) {
  return {
    // How hard the asset is geared to the current surprise mix.
    regime: clamp(50 + 18 * (a.bG * g + a.bI * i), 0, 100),
    // At low dial the desk wants quiet assets; at high dial it is paid to
    // hold volatile ones. Distance between asset risk and appetite.
    posture: clamp(100 - 100 * Math.abs(a.vol / 22 - dial / 100), 0, 100),
    carry: clamp(((a.carry + 0.5) / 5) * 100, 0, 100),
    premium: clamp(((a.er - CASH_RATE) / Math.max(a.vol, 1)) * 250, 0, 100),
  }
}

export function macroConviction(a, g, i, dial) {
  const c = macroComponents(a, g, i, dial)
  return Math.round(
    MACRO_WEIGHTS.regime * c.regime +
      MACRO_WEIGHTS.posture * c.posture +
      MACRO_WEIGHTS.carry * c.carry +
      MACRO_WEIGHTS.premium * c.premium,
  )
}

// Credit names grade off second-level divergence and margin of safety —
// the same formula the docket has always used.
export const creditConviction = (r) =>
  Math.round(clamp(52 + r.divergence / 3 + (r.mos - 0.55) * 60, 0, 100))

// Score → letter. Bands are 8 points wide, centered on the practical range
// the composite actually produces (~25–80).
const BANDS = [
  [85, 'A+'], [77, 'A'], [69, 'A−'], [61, 'B+'], [53, 'B'],
  [45, 'B−'], [37, 'C+'], [29, 'C'], [21, 'D'],
]
export function letterOf(score) {
  for (const [floor, letter] of BANDS) if (score >= floor) return letter
  return 'F'
}

// Tone for display: A-range laurel, B-range ink, C bronze, D/F terracotta.
export function toneOf(letter) {
  if (letter.startsWith('A')) return 'pos'
  if (letter.startsWith('B')) return ''
  if (letter.startsWith('C')) return 'muted'
  return 'neg'
}

// The whole universe graded on the current state: id → {score, letter}.
export function gradeBook({ g, i, dial }) {
  const out = {}
  for (const a of UNIVERSE) {
    const score = macroConviction(a, g, i, dial)
    out[a.id] = { score, letter: letterOf(score) }
  }
  return out
}
