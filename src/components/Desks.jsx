import { proxyVehicles, TRANSITION, RATING_BUCKETS, SCREENS } from '../engine/credit.js'

const VERDICT_CLASS = { PRIME: 'pos', HOLD: '', AVOID: 'neg', REJECT: 'neg' }
const pctCell = (p) => `${(p * 100).toFixed(p >= 0.1 ? 0 : p >= 0.01 ? 1 : 2)}%`

const pctCellSmall = (p) => `${(p * 100).toFixed(p >= 0.1 ? 1 : 2)}%`

// The two desks: the Panossian carry engine and the O'Leary powder keg.
export default function Desks({ screen, triggers, deploy, cycle, powderPct, edgar, onFetchEdgar, edgarFetching, edgarStatus }) {
  return (
    <div>
      <div className="panel">
        <h3 className="panel__title">Performing Credit Desk — the Engine Room</h3>
        <p className="gear__note" style={{ marginBottom: 'var(--space-1)' }}>
          Systematic screens: coverage ≥ {SCREENS.minCoverage.toFixed(1)}×, Merton distance-to-default
          ≥ {SCREENS.minDD.toFixed(1)}σ, ≥ {SCREENS.minSpreadPerTurn} bp of spread per turn of
          leverage, and the hard gate — the downside case must still return capital. Model-fair
          spread is the expected loss (PD × loss-given-default) plus a risk premium; positions are
          sized by margin of safety and capped at {SCREENS.maxName}% per name, {SCREENS.maxSector}%
          per sector.
        </p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Issuer</th>
                <th>Rating</th>
                <th className="r">Mkt Spr</th>
                <th className="r">Model</th>
                <th className="r">Cov ×</th>
                <th className="r">DD σ</th>
                <th className="r">PD·1y</th>
                <th className="r">EL bp</th>
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
                  <td className="r num">{r.marketSpread}</td>
                  <td className="r num">{r.modelSpread}</td>
                  <td className="r num">{r.cov.toFixed(1)}</td>
                  <td className={`r num ${r.dd < SCREENS.minDD ? 'neg' : ''}`}>{r.dd.toFixed(1)}</td>
                  <td className="r num">{pctCell(r.pd)}</td>
                  <td className="r num">{r.elSpread}</td>
                  <td className={`r num ${r.divergence >= 0 ? 'pos' : 'neg'}`}>
                    {r.divergence >= 0 ? '+' : '−'}{Math.abs(r.divergence)}
                  </td>
                  <td className="r num">{(r.mos * 100).toFixed(0)}%</td>
                  <td className="r num">
                    {r.weight ? `${r.weight.toFixed(1)}%` : '—'}
                    {r.capped && <span className="mono" style={{ color: 'var(--bronze)' }}> ▲</span>}
                  </td>
                  <td className={`mono ${VERDICT_CLASS[r.verdict]}`}>{r.verdict}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="footnote">
          “vs Model” is second-level thinking mechanized: market spread minus expected-loss-fair
          spread. Positive = the crowd demands more than the modeled risk warrants (our kind of
          name — quality carries a premium above its expected loss); negative = the market
          under-prices the tail. Alpha is permitted only where the model disagrees with consensus.
          ▲ marks a position trimmed by a concentration cap.
        </p>
      </div>

      <div className="panel panel--quiet" style={{ marginTop: 'var(--space-3)' }}>
        <h3 className="panel__title">One-Year Ratings-Transition Matrix</h3>
        <p className="gear__note" style={{ marginBottom: 'var(--space-1)' }}>
          The Markov migration probabilities behind the screen: where a rating bucket lands in a
          year. The far-right column — the probability of default — is what the expected-loss gate
          must survive; the diagonal is stability.
        </p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>From ↓ / To →</th>
                {RATING_BUCKETS.map((b) => (
                  <th key={b} className="r">{b}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {RATING_BUCKETS.slice(0, 4).map((from) => (
                <tr key={from}>
                  <td className="mono">{from}</td>
                  {TRANSITION[from].map((p, k) => (
                    <td
                      key={k}
                      className={`r num ${k === RATING_BUCKETS.length - 1 && p > 0.05 ? 'neg' : from === RATING_BUCKETS[k] ? 'pos' : ''}`}
                    >
                      {(p * 100).toFixed(1)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="footnote">
          Rows sum to 100%. Percentages, through-the-cycle. Default is absorbing.
        </p>
      </div>

      <div className="panel panel--quiet" style={{ marginTop: 'var(--space-3)' }}>
        <div className="dial__override-row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
          <h3 className="panel__title" style={{ margin: 0 }}>Live Fundamentals — SEC EDGAR</h3>
          <button
            type="button"
            className="btn btn--outline btn--small"
            onClick={onFetchEdgar}
            disabled={edgarFetching}
          >
            {edgarFetching ? 'Pulling…' : 'Pull from EDGAR'}
          </button>
        </div>
        <p className="gear__note" style={{ margin: 'var(--space-1) 0' }}>
          The same structural pipeline on real issuers: coverage and leverage from XBRL filings,
          then Merton distance-to-default, PD, and expected loss. Values are offline estimates until
          pulled live; the model only fetches the document, never interprets a number.
        </p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Issuer</th>
                <th>Rating</th>
                <th className="r">Cov ×</th>
                <th className="r">Lev ×</th>
                <th className="r">DD σ</th>
                <th className="r">PD·1y</th>
                <th className="r">EL bp</th>
                <th>Source</th>
              </tr>
            </thead>
            <tbody>
              {edgar.map((r) => (
                <tr key={r.ticker}>
                  <td>
                    {r.name} <span className="mono" style={{ opacity: 0.6 }}>{r.ticker}</span>
                    <div className="proxy__bounds mono">{r.sector}</div>
                  </td>
                  <td className="mono">{r.rating}</td>
                  <td className="r num">{r.error ? '—' : r.cov.toFixed(1)}</td>
                  <td className="r num">{r.error ? '—' : r.lev.toFixed(1)}</td>
                  <td className="r num">{r.error ? '—' : r.dd.toFixed(1)}</td>
                  <td className="r num">{r.error ? '—' : pctCellSmall(r.pd)}</td>
                  <td className="r num">{r.error ? '—' : r.elSpread}</td>
                  <td className="mono" style={{ color: r.source === 'EDGAR' ? 'var(--laurel)' : 'var(--limestone)' }}>
                    {r.error ? 'fetch failed' : r.source}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {edgarStatus && (
          <p className={`footnote ${edgarStatus.kind === 'error' ? 'statusline--error' : edgarStatus.kind === 'live' ? 'statusline--live' : ''}`}>
            {edgarStatus.text}
          </p>
        )}
      </div>

      <div className="grid-2" style={{ marginTop: 'var(--space-3)' }}>
        <div className={`panel ${deploy ? 'panel--laurel' : 'panel--quiet'}`}>
          <h3 className="panel__title">Opportunistic Desk — Dry Powder</h3>
          <div className="gear__figure">
            {powderPct}%<span className="lbl lbl--bronze"> of the credit mandate held as powder</span>
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
