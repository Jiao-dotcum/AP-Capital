import { riskOfRuin, RUIN_CEILING } from '../engine/machine.js'

// Risk-of-ruin monitor: tail-loss probability against the 2.5% ceiling.
export default function Safeguards({ current }) {
  const risk = riskOfRuin(current)
  const breached = risk > RUIN_CEILING
  const gaugePct = Math.min(100, (risk / (RUIN_CEILING * 1.5)) * 100)
  const ceilingPct = (RUIN_CEILING / (RUIN_CEILING * 1.5)) * 100

  return (
    <div className={`panel ${breached ? 'panel--terracotta' : 'panel--laurel'}`}>
      <div className="grid-2">
        <div>
          <div className="lbl">Risk-of-Ruin Monitor</div>
          <div className="gear__figure" style={breached ? { color: 'var(--terracotta)' } : undefined}>
            {(risk * 100).toFixed(2)}%
            <span className="lbl lbl--bronze"> tail-loss probability</span>
          </div>
          <div className="gear__meter" style={{ position: 'relative' }}>
            <i
              style={{
                width: `${gaugePct}%`,
                background: breached ? 'var(--terracotta)' : 'var(--laurel)',
              }}
            />
            <span
              aria-hidden="true"
              style={{
                position: 'absolute',
                left: `${ceilingPct}%`,
                top: '-4px',
                bottom: '-4px',
                width: '2px',
                background: 'var(--ink)',
              }}
            />
          </div>
          <p className="gear__note">
            Ceiling {(RUIN_CEILING * 100).toFixed(1)}%. Derived from the magnitude of the current
            surprises — large shocks in either direction widen the tail.
          </p>
        </div>
        <div>
          <div className="lbl">Standing Orders</div>
          <p className="gear__note" style={{ marginTop: '0.4rem' }}>
            {breached ? (
              <>
                The ceiling is breached. Gross positions are scaled to 60%, tail hedges are
                executed, and manual override is refused. The machine does not negotiate with a
                drawdown.
              </>
            ) : (
              <>
                Within tolerance. Positions run at full weight. If the tail-loss probability
                crosses the ceiling, the hardstop engages automatically: positions to 60%, hedges
                on, no manual override.
              </>
            )}
          </p>
        </div>
      </div>
    </div>
  )
}
