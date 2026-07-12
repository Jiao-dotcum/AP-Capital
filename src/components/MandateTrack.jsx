import { useMemo, useState } from 'react'
import { windowStats } from '../engine/backtest.js'

const MAX_YEARS = 22
const money = (n) => '$' + Math.round(n).toLocaleString()
const pct = (n) => `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(1)}%`

// A single-series growth curve: ink line on stone, same anatomy as the
// legacy dual-series chart in Backtest.jsx but one line, one mandate.
function GrowthCurve({ w, color }) {
  const W = 640
  const H = 130
  const M = { top: 10, right: 12, bottom: 16, left: 50 }
  const a = w.navPath
  const lo = Math.min(...a)
  const hi = Math.max(...a)
  const pad = (hi - lo) * 0.08 || 0.05
  const yMin = lo - pad
  const yMax = hi + pad
  const xOf = (k) => M.left + (k / (a.length - 1)) * (W - M.left - M.right)
  const yOf = (v) => M.top + (1 - (v - yMin) / (yMax - yMin)) * (H - M.top - M.bottom)
  const path = a.map((v, k) => `${k ? 'L' : 'M'}${xOf(k).toFixed(1)} ${yOf(v).toFixed(1)}`).join(' ')
  const gain = a[a.length - 1] >= 1
  const ticks = [yMin, (yMin + yMax) / 2, yMax]
  return (
    <svg className="fan-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Growth of ten thousand dollars, ending at ${money(w.growthOf)}.`}>
      {ticks.map((t, k) => (
        <g key={k}>
          <line x1={M.left} x2={W - M.right} y1={yOf(t)} y2={yOf(t)} stroke="var(--line)" strokeWidth="1" />
          <text x={M.left - 8} y={yOf(t) + 3.5} textAnchor="end" className="fan-tick">{money(t * 10000)}</text>
        </g>
      ))}
      <line x1={M.left} x2={W - M.right} y1={yOf(1)} y2={yOf(1)} stroke="var(--bronze)" strokeWidth="1" strokeDasharray="1 4" />
      <path d={path} fill="none" stroke={color || (gain ? 'var(--laurel)' : 'var(--terracotta)')} strokeWidth="2" />
      <rect x={M.left} y={M.top} width={W - M.left - M.right} height={H - M.top - M.bottom} fill="none" stroke="var(--bronze)" strokeWidth="1" />
      <style>{`.fan-tick { font-family: var(--font-mono); font-size: 10px; fill: var(--limestone); }`}</style>
    </svg>
  )
}

function Stat({ label, value, tone }) {
  return (
    <div className="wstat">
      <div className="lbl">{label}</div>
      <div className={`num wstat__figure ${tone || ''}`}>{value}</div>
    </div>
  )
}

// One mandate's own return track: a growth-of-$10,000 curve plus a lookback
// slider, compounding the trailing N years into an annualized, time-weighted
// result (windowStats — the same function the legacy Proving Ground uses).
// Each mandate gets its own instance, its own series, its own accent.
export default function MandateTrack({ id, title, engine, series, accent, note }) {
  const [look, setLook] = useState(10)
  const w = useMemo(() => windowStats(series, look), [series, look])
  if (!w) return null
  return (
    <div className="panel panel--quiet">
      <div className="dial__override-row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span className="lbl lbl--ink">{title}</span>
        <span className="mono" style={{ color: 'var(--bronze)' }}>{engine}</span>
      </div>

      <div className="slider" style={{ marginTop: '0.6rem' }}>
        <label className="lbl" htmlFor={`look-${id}`}>Lookback</label>
        <input
          id={`look-${id}`}
          type="range"
          min="1"
          max={MAX_YEARS}
          value={look}
          onChange={(e) => setLook(Number(e.target.value))}
          aria-label={`${title} lookback, ${look} years`}
        />
        <span className="mono num slider__value">{look} yr</span>
      </div>

      <GrowthCurve w={w} color={accent} />

      <div className="wstat-row">
        <Stat label="Growth of $10,000" value={money(w.growthOf)} tone={w.cumulative >= 0 ? 'pos' : 'neg'} />
        <Stat label="Annualized (CAGR)" value={pct(w.cagr)} tone={w.cagr >= 0 ? 'pos' : 'neg'} />
        <Stat label="Volatility" value={`${w.vol}%`} />
        <Stat label="Max Drawdown" value={`−${w.maxDD}%`} tone="neg" />
        <Stat label="Sharpe" value={w.sharpe.toFixed(2)} />
      </div>

      {note && <p className="footnote">{note}</p>}
    </div>
  )
}
