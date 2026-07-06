import { riskOfRuin, RUIN_CEILING } from '../engine/machine.js'

// Phase III made visible: the constraints that survive contact with the
// real world, encoded as standing charter articles rather than aspirations.
const CHARTER = [
  {
    title: 'Article 1 — Proxies Only',
    body: 'True distressed debt is negotiated, legal-process-driven, and access-gated; it does not automate at this scale. The Opportunistic desk trades listed proxies — HY and loan ETFs, CLO debt, BDCs, closed-end funds at NAV discounts — and nothing else.',
  },
  {
    title: 'Article 2 — Own Capital Only',
    body: 'The machine manages its own capital. Outside money requires RIA registration, custody, a compliance manual, Form ADV, and documented human oversight of the automation — none of which are assumed here.',
  },
  {
    title: 'Article 3 — The Judgment Residual',
    body: 'Cycle positioning is judgment that resists full mechanization. The Co-CEO agents recommend; a human ratifies — the dial override above is that checkpoint. This is not a compromise of the vision; it is the difference between a system that survives its first regime change and one that does not.',
  },
]

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

      <div className="charter">
        <div className="lbl lbl--ink" style={{ textAlign: 'center', margin: 'var(--space-2) 0 var(--space-1)' }}>
          The Charter — Phase III Standing Constraints
        </div>
        <div className="charter__grid">
          {CHARTER.map((a) => (
            <div key={a.title} className="charter__article">
              <div className="charter__title">{a.title}</div>
              <p className="gear__note">{a.body}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
