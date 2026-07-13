import { UNIVERSE } from './assets.js'
import { PRINCIPLES } from './rules.js'
import { returnHistory, ledoitWolf } from './risk.js'

// ————— Pure Alpha, properly constructed —————
// The six IF/THEN principles were display-only: evaluated live, backtested
// for hit rates, but wired to nothing. The naive way to trade them — each
// fired principle as a full-notional spread bet — was measured and failed
// hard (Sharpe −0.29, 61% drawdown on the canonical path): a handful of
// undiversified pair trades at unscaled size is a construction error, not a
// signal error. This module is the construction the signals deserve:
//
//   1. Each principle maps to a LONG/SHORT leg set (its THEN, literally).
//   2. Each fired bet is risk-balanced: weighted by the inverse of its own
//      spread volatility (from the same Ledoit–Wolf covariance the risk desk
//      uses), so a quiet rates spread and a loud commodity spread carry the
//      same risk, echoing how the beta book equalizes seasons.
//   3. The COMBINED tilt is scaled to a fixed volatility budget
//      (PA_VOL_TARGET, annualized) using the full covariance — more
//      simultaneous bets means more diversification, not more risk.
//   4. Gross is capped (PA_MAX_GROSS) so tiny measured vols can never
//      justify silly leverage.
//
// The overlay rides INSIDE the All Weather Core mandate (its 10% Pure Alpha
// capital sleeve, expressed as a risk budget rather than a cash bucket) via
// coreTargets(): base risk-parity weights plus the tilt, clamped long-only
// and scaled to gross ≤ 1 so the paper book never borrows and never shorts —
// a short leg can only *reduce* an existing long. One formula, one module:
// the live book and the backtest call this exact function.

export const PA_VOL_TARGET = 4 // % annualized, the overlay's whole risk budget
export const PA_MAX_GROSS = 0.5 // Σ|tilt| ceiling, fraction of NAV

// Each principle's THEN as tradeable legs (P·04 is "no tilt" by definition).
export const PRINCIPLE_LEGS = {
  'P·01': { gsci: 1, ust10: -1 },
  'P·02': { tips: 1, ust10: -1 },
  'P·03': { gold: 0.5, gsci: 0.5, usEq: -1 },
  'P·04': {},
  'P·05': { usEq: 0.5, igc: 0.5, gold: -1 },
  'P·06': { ust30: 1, fxc: -1 },
}

const IDS = UNIVERSE.map((a) => a.id)
const IDX = Object.fromEntries(IDS.map((id, k) => [id, k]))

let _cov = null
const cov = () => (_cov ??= ledoitWolf(returnHistory().R).cov)

const quadVol = (w) => {
  // annualized % vol of a weight vector under the monthly covariance
  const c = cov()
  let s = 0
  for (const [i, wi] of Object.entries(w)) {
    for (const [j, wj] of Object.entries(w)) s += wi * wj * c[IDX[i]][IDX[j]]
  }
  return Math.sqrt(Math.max(s, 1e-12) * 12)
}

// The tilt for a reading: fired principles → risk-balanced legs → combined
// vector scaled to the vol budget, gross-capped. Deterministic, no rng.
export function pureAlphaTilt(g, i) {
  const fired = PRINCIPLES.filter((p) => p.test(g, i)).map((p) => p.id)
  const active = fired.filter((id) => Object.keys(PRINCIPLE_LEGS[id]).length)
  if (!active.length) return { tilt: {}, fired, gross: 0 }

  // Risk-balance each bet, then sum.
  const combined = {}
  for (const id of active) {
    const legs = PRINCIPLE_LEGS[id]
    const betVol = quadVol(legs)
    for (const [asset, w] of Object.entries(legs)) {
      combined[asset] = (combined[asset] ?? 0) + w / betVol
    }
  }
  // Scale the combined book to the budget; cap gross.
  const scale = PA_VOL_TARGET / quadVol(combined)
  let tilt = Object.fromEntries(Object.entries(combined).map(([a, w]) => [a, w * scale]))
  const gross = Object.values(tilt).reduce((s, w) => s + Math.abs(w), 0)
  if (gross > PA_MAX_GROSS) {
    const f = PA_MAX_GROSS / gross
    tilt = Object.fromEntries(Object.entries(tilt).map(([a, w]) => [a, w * f]))
  }
  return {
    tilt: Object.fromEntries(Object.entries(tilt).map(([a, w]) => [a, +w.toFixed(4)])),
    fired,
    gross: +Math.min(gross, PA_MAX_GROSS).toFixed(3),
  }
}

// The Core mandate's combined target: risk parity plus the alpha tilt,
// long-only (a short leg reduces an existing long, never goes net short) and
// scaled back if the sum exceeds 1 so the book never borrows. Residual, if
// any, falls to cash in the OMS as always.
export function coreTargets(rpWeights, tilt) {
  const out = {}
  for (const id of new Set([...Object.keys(rpWeights), ...Object.keys(tilt)])) {
    out[id] = Math.max(0, (rpWeights[id] ?? 0) + (tilt[id] ?? 0))
  }
  const tot = Object.values(out).reduce((s, w) => s + w, 0)
  if (tot > 1) for (const id of Object.keys(out)) out[id] /= tot
  return out
}
