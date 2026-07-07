import { releasesFrom } from '../engine/machine.js'

const sig = (v) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(2)}σ`

// Priced-in vs actual vs surprise. When a live tape is supplied the rows are
// real point-in-time prints against market-implied expectations; otherwise
// they are derived from the surprise state against priced-in constants.
export default function Releases({ current, tape = null }) {
  const rows = tape ?? releasesFrom(current)
  return (
    <div className="panel panel--quiet" style={{ marginTop: 'var(--space-3)' }}>
      <div className="lbl lbl--ink" style={{ textAlign: 'center', marginBottom: 'var(--space-2)' }}>
        The Tape — Surprise = Actual − Expected
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Release</th>
              <th>Period</th>
              <th className="r">Priced In</th>
              <th className="r">Actual</th>
              <th className="r">Surprise</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.name}>
                <td>{r.name}</td>
                <td className="mono">{r.period}</td>
                <td className="r num">{r.priced.toFixed(r.name.includes('Policy') ? 3 : 2)}%</td>
                <td className="r num">{r.actual.toFixed(r.name.includes('Policy') ? 3 : 2)}%</td>
                <td className={`r num ${r.sigma >= 0 ? 'pos' : 'neg'}`}>{sig(r.sigma)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="footnote" style={{ textAlign: 'center' }}>
        {tape
          ? 'Real point-in-time prints — priced-in from market-implied expectations where an instrument exists (breakeven inflation, the 1y Treasury policy path); growth against the documented consensus constant.'
          : current.source === 'live'
            ? 'Latest reading converted from live prints against priced-in constants.'
            : 'Prints are simulated against priced-in constants with a seeded generator — reproducible by design.'}
      </p>
    </div>
  )
}
