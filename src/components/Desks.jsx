import { proxyVehicles } from '../engine/credit.js'

const VERDICT_CLASS = { PRIME: 'pos', HOLD: '', AVOID: 'neg', REJECT: 'neg' }

// The two desks: the Panossian carry engine and the O'Leary powder keg.
export default function Desks({ screen, triggers, deploy, cycle, powderPct }) {
  return (
    <div>
      <div className="panel">
        <h3 className="panel__title">Performing Credit Desk — the Engine Room</h3>
        <p className="gear__note" style={{ marginBottom: 'var(--space-1)' }}>
          Systematic screens: coverage ≥ 2×, distance-to-default ≥ 2σ, ≥ 90 bp of spread per turn of
          leverage, and the hard gate — the downside case must still return capital. Positions are
          sized by margin of safety, never by upside.
        </p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Issuer</th>
                <th>Rating</th>
                <th className="r">Spread</th>
                <th className="r">Per Turn</th>
                <th className="r">Cov ×</th>
                <th className="r">DD σ</th>
                <th className="r">vs Model</th>
                <th className="r">MoS</th>
                <th className="r">Weight</th>
                <th>Verdict</th>
              </tr>
            </thead>
            <tbody>
              {screen.map((r) => (
                <tr key={r.id} style={r.weight === 0 ? { color: 'var(--limestone)' } : undefined}>
                  <td>
                    {r.name}
                    <div className="proxy__bounds mono">{r.sector}</div>
                  </td>
                  <td className="mono">{r.rating}</td>
                  <td className="r num">{r.marketSpread} bp</td>
                  <td className="r num">{r.spreadPerTurn} bp</td>
                  <td className="r num">{r.cov.toFixed(1)}</td>
                  <td className="r num">{r.dd.toFixed(1)}</td>
                  <td className={`r num ${r.divergence >= 0 ? 'pos' : 'neg'}`}>
                    {r.divergence >= 0 ? '+' : '−'}{Math.abs(r.divergence)}
                  </td>
                  <td className="r num">{(r.mos * 100).toFixed(0)}%</td>
                  <td className="r num">{r.weight ? `${r.weight.toFixed(1)}%` : '—'}</td>
                  <td className={`mono ${VERDICT_CLASS[r.verdict]}`}>{r.verdict}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="footnote">
          “vs Model” is second-level thinking mechanized: market spread minus model-fair spread.
          Positive = the crowd demands more than the risk warrants (our kind of name); negative =
          priced for perfection. Alpha is permitted only where the model disagrees with consensus.
        </p>
      </div>

      <div className="grid-2" style={{ marginTop: 'var(--space-3)' }}>
        <div className={`panel ${deploy ? 'panel--laurel' : 'panel--quiet'}`}>
          <h3 className="panel__title">Opportunistic Desk — Dry Powder</h3>
          <div className="gear__figure">
            {powderPct}%<span className="lbl lbl--bronze"> of book held as powder</span>
          </div>
          {triggers.map((t) => (
            <div key={t.name} className="trigger">
              <span className={`principle__state principle__state--${t.armed ? 'fired' : 'dormant'}`}>
                {t.armed ? 'Armed' : 'Standby'}
              </span>
              <span>
                {t.name}
                <span className="mono" style={{ color: 'var(--limestone)' }}> · now {t.reading}</span>
              </span>
            </div>
          ))}
          <p className="gear__note" style={{ marginTop: 'var(--space-1)' }}>
            {deploy
              ? 'Two or more triggers armed — deployment is authorized and flows through the risk gate and committee below.'
              : 'The desk sits idle most of the cycle, and the system tolerates the idleness. Idle capital tempts models to reach for yield; this one is hard-coded not to.'}
          </p>
        </div>

        <div className="panel panel--quiet">
          <h3 className="panel__title">Deployment Proxies</h3>
          <p className="gear__note" style={{ marginBottom: 'var(--space-1)' }}>
            True distressed debt is negotiated, legal-process-driven, and access-gated — not
            automatable at this scale. The desk trades listed proxies on the triggers instead.
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Instrument</th>
                  <th>Signal</th>
                  <th className="r">Now</th>
                </tr>
              </thead>
              <tbody>
                {proxyVehicles(cycle).map((v) => (
                  <tr key={v.name}>
                    <td>{v.name}</td>
                    <td className="mono" style={{ color: 'var(--bronze)' }}>{v.metric}</td>
                    <td className="r num">{v.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
