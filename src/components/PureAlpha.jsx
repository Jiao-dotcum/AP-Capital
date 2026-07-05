import { evaluatePrinciples } from '../engine/rules.js'

// The rules engine: IF/THEN principles evaluated against the live surprises.
export default function PureAlpha({ current }) {
  const principles = evaluatePrinciples(current.g, current.i)
  const firedCount = principles.filter((p) => p.fired).length

  return (
    <div className="panel">
      <div className="lbl lbl--ink" style={{ textAlign: 'center', marginBottom: 'var(--space-2)' }}>
        {firedCount} of {principles.length} principles firing at g {fmt(current.g)}σ · i {fmt(current.i)}σ
      </div>
      {principles.map((p) => (
        <div key={p.id} className={`principle${p.fired ? '' : ' principle--dormant'}`}>
          <span className={`principle__state principle__state--${p.fired ? 'fired' : 'dormant'}`}>
            {p.fired ? 'Fired' : 'Dormant'}
          </span>
          <div className="principle__body">
            <div>
              <span className="mono" style={{ color: 'var(--limestone)' }}>{p.id}</span>{' '}
              <strong>IF</strong> {p.when}
            </div>
            <div className="principle__then">
              <strong>THEN</strong> {p.then}
            </div>
          </div>
        </div>
      ))}
      <p className="footnote" style={{ textAlign: 'center' }}>
        Manual override is refused. A principle changes only by rewrite followed by a hundred-year
        backtest — never by discretion on the day.
      </p>
    </div>
  )
}

const fmt = (v) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(2)}`
