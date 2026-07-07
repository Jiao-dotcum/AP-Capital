import { useMemo } from 'react'
import { simulateFan, annualized, N_PATHS, N_QUARTERS, PAIRWISE_RHO } from '../engine/montecarlo.js'
import RiskMath from './RiskMath.jsx'

const W = 760
const H = 400
const M = { top: 20, right: 20, bottom: 40, left: 62 }

// Percentile fan chart (5/25/50/75/95) of 400 GBM paths, growth of 100,
// ten years at quarterly steps. Recomputes on any selection change. When a
// risk report is supplied the fan is driven by the risk-parity book on the
// Ledoit–Wolf covariance rather than the equal-weight ρ = 0.25 fallback.
export default function MonteCarlo({ assets, risk = null }) {
  const fan = useMemo(
    () => simulateFan(assets, risk ? risk.moments : null),
    [assets, risk],
  )

  if (!fan) {
    return (
      <div className="panel panel--quiet" style={{ textAlign: 'center' }}>
        <p className="gear__note">
          No holdings elected. Tick assets in the Register above to convene a portfolio.
        </p>
      </div>
    )
  }

  const { bands, terminal, mu, sigma } = fan
  const yMax = terminal.p95 * 1.06
  const yMin = Math.min(100, bands.reduce((m, b) => Math.min(m, b.p5), Infinity)) * 0.92
  const xOf = (q) => M.left + (q / N_QUARTERS) * (W - M.left - M.right)
  const yOf = (v) => M.top + (1 - (v - yMin) / (yMax - yMin)) * (H - M.top - M.bottom)

  const line = (key) => bands.map((b, k) => `${k ? 'L' : 'M'}${xOf(b.q).toFixed(1)} ${yOf(b[key]).toFixed(1)}`).join(' ')
  const area = (hiKey, loKey) =>
    bands.map((b, k) => `${k ? 'L' : 'M'}${xOf(b.q).toFixed(1)} ${yOf(b[hiKey]).toFixed(1)}`).join(' ') +
    [...bands].reverse().map((b) => `L${xOf(b.q).toFixed(1)} ${yOf(b[loKey]).toFixed(1)}`).join(' ') +
    'Z'

  const yTicks = niceTicks(yMin, yMax, 5)
  const rows = [
    ['95th percentile', terminal.p95, 'var(--laurel)'],
    ['75th percentile', terminal.p75, null],
    ['Median', terminal.p50, null],
    ['25th percentile', terminal.p25, null],
    ['5th percentile', terminal.p5, 'var(--terracotta)'],
  ]

  return (
    <>
    <div className="grid-hero">
      <div className="panel">
        <h3 className="panel__title">
          Growth of 100 — {assets.length} Elected Holdings, {risk ? 'Risk Parity' : 'Equal Weight'}
        </h3>
        <svg
          className="fan-svg"
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label={`Monte Carlo fan chart. Median terminal value ${terminal.p50.toFixed(0)}, fifth percentile ${terminal.p5.toFixed(0)}, ninety-fifth percentile ${terminal.p95.toFixed(0)}.`}
        >
          {/* hairline grid + axis labels */}
          {yTicks.map((t) => (
            <g key={t}>
              <line x1={M.left} x2={W - M.right} y1={yOf(t)} y2={yOf(t)} stroke="var(--line)" strokeWidth="1" />
              <text x={M.left - 8} y={yOf(t) + 3.5} textAnchor="end" className="fan-tick">
                {t}
              </text>
            </g>
          ))}
          {[0, 2, 4, 6, 8, 10].map((yr) => (
            <text key={yr} x={xOf(yr * 4)} y={H - M.bottom + 18} textAnchor="middle" className="fan-tick">
              {yr === 0 ? 'Yr 0' : yr}
            </text>
          ))}

          {/* percentile bands: Wedgwood at 12% and 24% */}
          <path d={area('p95', 'p5')} fill="var(--wedgwood)" opacity="0.12" />
          <path d={area('p75', 'p25')} fill="var(--wedgwood)" opacity="0.24" />

          {/* initial-value reference */}
          <line x1={M.left} x2={W - M.right} y1={yOf(100)} y2={yOf(100)} stroke="var(--bronze)" strokeWidth="1" strokeDasharray="1 4" />
          <text x={M.left + 4} y={yOf(100) - 5} className="fan-tick">
            initial value 100
          </text>

          {/* extremes dashed, median in carbon ink */}
          <path d={line('p5')} fill="none" stroke="var(--terracotta)" strokeWidth="1.5" strokeDasharray="5 4" />
          <path d={line('p95')} fill="none" stroke="var(--laurel)" strokeWidth="1.5" strokeDasharray="5 4" />
          <path d={line('p50')} fill="none" stroke="var(--ink)" strokeWidth="2" />

          {/* direct labels at the right edge */}
          <text x={W - M.right - 2} y={yOf(terminal.p95) - 6} textAnchor="end" className="fan-lab" fill="var(--laurel)">
            95th
          </text>
          <text x={W - M.right - 2} y={yOf(terminal.p50) - 6} textAnchor="end" className="fan-lab" fill="var(--ink)">
            Median
          </text>
          <text x={W - M.right - 2} y={yOf(terminal.p5) + 14} textAnchor="end" className="fan-lab" fill="var(--terracotta)">
            5th
          </text>

          {/* frame */}
          <rect x={M.left} y={M.top} width={W - M.left - M.right} height={H - M.top - M.bottom} fill="none" stroke="var(--bronze)" strokeWidth="1" />
        </svg>
        <p className="footnote">
          {N_PATHS} geometric Brownian paths, {N_QUARTERS} quarterly steps.{' '}
          {risk
            ? `Risk-parity book on the Ledoit–Wolf-shrunk covariance (δ = ${risk.lw.delta}), dial gross ${risk.rp.gross}×.`
            : `Pairwise correlation assumption ρ = ${PAIRWISE_RHO}, equal weight.`}{' '}
          Portfolio μ {(mu * 100).toFixed(1)}% · σ {(sigma * 100).toFixed(1)}% annualized. Seeded —
          identical elections reproduce identical fans.
        </p>
        <style>{`
          .fan-tick { font-family: var(--font-mono); font-size: 10.5px; fill: var(--limestone); }
          .fan-lab { font-family: var(--font-mono); font-size: 10.5px; letter-spacing: 0.12em; text-transform: uppercase; }
        `}</style>
      </div>

      <div className="panel panel--quiet">
        <h3 className="panel__title">Terminal Values, Year Ten</h3>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Outcome</th>
                <th className="r">Value of 100</th>
                <th className="r">Annualized</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(([name, v, color]) => (
                <tr key={name}>
                  <td style={color ? { color } : undefined}>{name}</td>
                  <td className="r num">{v.toFixed(1)}</td>
                  <td className={`r num ${annualized(v) >= 0 ? 'pos' : 'neg'}`}>
                    {(annualized(v) * 100).toFixed(2)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="footnote">
          The fan is the honest statement of a forecast: a distribution, not a number.
        </p>
      </div>
    </div>
    <RiskMath report={risk} />
    </>
  )
}

function niceTicks(lo, hi, n) {
  const span = hi - lo
  const step = Math.pow(10, Math.floor(Math.log10(span / n)))
  const err = span / n / step
  const mult = err >= 7.5 ? 10 : err >= 3.5 ? 5 : err >= 1.5 ? 2 : 1
  const s = step * mult
  const ticks = []
  for (let t = Math.ceil(lo / s) * s; t <= hi; t += s) ticks.push(Math.round(t))
  return ticks
}
