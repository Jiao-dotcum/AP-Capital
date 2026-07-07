import { useMemo, useState } from 'react'
import { windowStats } from '../engine/backtest.js'

const MAX_YEARS = 22
const money = (n) => '$' + Math.round(n).toLocaleString()
const pct = (n) => `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(1)}%`

// A NAV growth curve for the selected window: growth of $10,000, ink line on
// stone, with the fixed mid-dial book dashed behind it.
function GrowthCurve({ managed, fixed }) {
  const W = 720
  const H = 150
  const M = { top: 12, right: 14, bottom: 18, left: 52 }
  const a = managed.navPath
  const b = fixed.navPath
  const lo = Math.min(...a, ...b)
  const hi = Math.max(...a, ...b)
  const pad = (hi - lo) * 0.08 || 0.05
  const yMin = lo - pad
  const yMax = hi + pad
  const xOf = (k, arr) => M.left + (k / (arr.length - 1)) * (W - M.left - M.right)
  const yOf = (v) => M.top + (1 - (v - yMin) / (yMax - yMin)) * (H - M.top - M.bottom)
  const path = (arr) => arr.map((v, k) => `${k ? 'L' : 'M'}${xOf(k, arr).toFixed(1)} ${yOf(v).toFixed(1)}`).join(' ')
  const gain = managed.navPath[managed.navPath.length - 1] >= 1
  const ticks = [yMin, (yMin + yMax) / 2, yMax]
  return (
    <svg className="fan-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Growth of ten thousand dollars over the window, ending at ${money(managed.growthOf)}.`}>
      {ticks.map((t, k) => (
        <g key={k}>
          <line x1={M.left} x2={W - M.right} y1={yOf(t)} y2={yOf(t)} stroke="var(--line)" strokeWidth="1" />
          <text x={M.left - 8} y={yOf(t) + 3.5} textAnchor="end" className="fan-tick">{money(t * 10000)}</text>
        </g>
      ))}
      <line x1={M.left} x2={W - M.right} y1={yOf(1)} y2={yOf(1)} stroke="var(--bronze)" strokeWidth="1" strokeDasharray="1 4" />
      <path d={path(b)} fill="none" stroke="var(--limestone)" strokeWidth="1.4" strokeDasharray="5 4" />
      <path d={path(a)} fill="none" stroke={gain ? 'var(--laurel)' : 'var(--terracotta)'} strokeWidth="2" />
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

// The walk-forward proving ground: rules frozen at T, graded at T+1, across
// twenty-two simulated years — plus a lookback slider that compounds the
// trailing N years into an annualized, time-weighted result.
export default function Backtest({ report }) {
  const { years, months, principles, regimes, dial, turnover, book, deadband, series } = report
  const [look, setLook] = useState(10)
  const w = useMemo(() => windowStats(series.managed, look), [series, look])
  const f = useMemo(() => windowStats(series.fixed, look), [series, look])
  if (!w) return null

  return (
    <div className="panel panel--quiet" style={{ marginTop: 'var(--space-3)' }}>
      <div className="lbl lbl--ink" style={{ textAlign: 'center', marginBottom: 'var(--space-2)' }}>
        Had We Run the Strategy — {look}-Year Lookback
      </div>

      <div className="slider">
        <label className="lbl" htmlFor="lookback">Lookback</label>
        <input
          id="lookback"
          type="range"
          min="1"
          max={MAX_YEARS}
          value={look}
          onChange={(e) => setLook(Number(e.target.value))}
          aria-label={`Backtest lookback, ${look} years`}
        />
        <span className="mono num slider__value">{look} yr</span>
      </div>

      <GrowthCurve managed={w} fixed={f} />

      <div className="wstat-row">
        <Stat label="Growth of $10,000" value={money(w.growthOf)} tone={w.cumulative >= 0 ? 'pos' : 'neg'} />
        <Stat label="Cumulative Return" value={pct(w.cumulative)} tone={w.cumulative >= 0 ? 'pos' : 'neg'} />
        <Stat label="Annualized (CAGR)" value={pct(w.cagr)} tone={w.cagr >= 0 ? 'pos' : 'neg'} />
        <Stat label="Volatility" value={`${w.vol}%`} />
        <Stat label="Max Drawdown" value={`−${w.maxDD}%`} tone="neg" />
        <Stat label="Sharpe" value={w.sharpe.toFixed(2)} />
      </div>

      <p className="footnote" style={{ textAlign: 'center' }}>
        The dial-managed book compounded over the trailing {look} year{look === 1 ? '' : 's'}
        ({w.months} months): {pct(w.cumulative)} cumulative, {pct(w.cagr)} annualized — versus the
        fixed mid-dial book at {pct(f.cagr)}/yr (dashed). This is a <b>time-weighted</b> return
        (annualized HPR), the correct measure for a systematically rebalanced book: it reflects the
        strategy, not the timing of any deposits. A money-weighted return (XIRR) becomes a separate,
        meaningful figure only once real investor contributions and withdrawals exist.
      </p>

      <div className="lbl lbl--ink" style={{ textAlign: 'center', margin: 'var(--space-3) 0 var(--space-2)' }}>
        The Proving Ground — {years}-Year Walk-Forward
      </div>

      <div className="grid-2 grid-2--top">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Principle</th>
                <th className="r">Fired</th>
                <th className="r">Hit Rate</th>
              </tr>
            </thead>
            <tbody>
              {principles.map((p) => (
                <tr key={p.id}>
                  <td>
                    <span className="mono">{p.id}</span> — {p.then}
                  </td>
                  <td className="r num">{p.fires}×</td>
                  <td className="r num">{p.hitRate === null ? '—' : `${p.hitRate}%`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Regime Call</th>
                <th className="r">Months</th>
                <th className="r">Beat Baseline</th>
              </tr>
            </thead>
            <tbody>
              {regimes.map((r) => (
                <tr key={r.key}>
                  <td>{r.label}</td>
                  <td className="r num">{r.n}</td>
                  <td className="r num">{r.hitRate === null ? '—' : `${r.hitRate}%`}</td>
                </tr>
              ))}
              <tr>
                <td>Dial — Offense preceded tightening</td>
                <td className="r num">{dial.offense.n}</td>
                <td className="r num">{dial.offense.hitRate === null ? '—' : `${dial.offense.hitRate}%`}</td>
              </tr>
              <tr>
                <td>Dial — Defense preceded widening</td>
                <td className="r num">{dial.defense.n}</td>
                <td className="r num">{dial.defense.hitRate === null ? '—' : `${dial.defense.hitRate}%`}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <p className="footnote" style={{ textAlign: 'center' }}>
        {months} graded releases, rules frozen at T against data knowable at T, scored strictly at
        T+1. Full-window dial-managed book: {book.cagr}%/yr at {book.vol}% vol, max drawdown{' '}
        {book.maxDD}% (fixed mid-dial book {book.cagrFixed}%/yr). Turnover {turnover.settled}pp per
        release with the ±{deadband} deadband against {turnover.unsettled}pp without. Simulated
        world, model assumptions throughout — the harness measures the rules, not the future.
      </p>
    </div>
  )
}
