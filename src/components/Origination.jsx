// The Origination Desk: the machine's ranked nominations for the next
// dollar, plus the sourcing engine that feeds it. Read-only — the docket
// proposes, the desks and the committee dispose.
export default function Origination({ ideas, sourcing }) {
  return (
    <div>
    <div className="panel">
      <h3 className="panel__title">The Docket — Ranked Convictions</h3>
      <ol className="docket">
        {ideas.map((idea, k) => (
          <li key={idea.key} className="docket__row">
            <span className="docket__rank num" aria-hidden="true">
              {k + 1}
            </span>
            <div className="docket__body">
              <div className="docket__name">
                {idea.name}
                <span className="lbl docket__type"> {idea.type}</span>
              </div>
              <p className="gear__note docket__thesis">{idea.thesis}</p>
              <div className="docket__drivers lbl">
                {idea.drivers.map((d) => (
                  <span key={d.label} className="docket__driver">
                    {d.label} <b className="num">{d.value}</b>
                  </span>
                ))}
              </div>
            </div>
            <div className="docket__score">
              <span className="num docket__figure">{idea.conviction}</span>
              <div className="gear__meter" style={{ margin: '0.35rem 0 0' }}>
                <i style={{ width: `${idea.conviction}%` }} />
              </div>
              <span className="lbl">conviction</span>
            </div>
          </li>
        ))}
      </ol>
      <p className="footnote">
        Conviction merges regime fit, cycle-posture fit, carry, and risk-adjusted premium; credit
        nominations add consensus divergence and margin of safety. The docket only nominates —
        every idea still passes the screens, the risk layer, and the committee before it is sized.
      </p>
    </div>

    {sourcing && <SourcingEngine sourcing={sourcing} />}
    </div>
  )
}

// The sourcing engine: a forced-seller detector and a catalyst scanner, every
// lead graded at the hard second-level gate before it reaches the docket.
function SourcingEngine({ sourcing }) {
  const { forced, leads } = sourcing
  return (
    <div className="panel panel--quiet" style={{ marginTop: 'var(--space-3)' }}>
      <h3 className="panel__title">The Sourcing Engine — Catalysts & Forced Sellers</h3>

      <div className="grid-2 grid-2--top" style={{ marginBottom: 'var(--space-2)' }}>
        <div>
          <div className="lbl lbl--ink" style={{ marginBottom: '0.4rem' }}>Forced-Seller Detector</div>
          <div className="gear__figure" style={forced.active ? { color: 'var(--laurel)' } : undefined}>
            {forced.intensity}
            <span className="lbl lbl--bronze"> / 100 non-fundamental selling</span>
          </div>
          <div className="gear__meter" style={{ margin: '0.35rem 0' }}>
            <i style={{ width: `${forced.intensity}%`, background: forced.active ? 'var(--laurel)' : 'var(--wedgwood)' }} />
          </div>
          <p className="gear__note">
            Flow capitulation {forced.flowSigma >= 0 ? '+' : ''}{forced.flowSigma}σ
            {forced.capitulation ? ' — past the 2σ line' : ''} · margin pressure{' '}
            {(forced.marginPressure * 100).toFixed(0)}% · cycle stress {(forced.stress * 100).toFixed(0)}%.
            {forced.active
              ? ' Someone is selling for reasons that have nothing to do with value.'
              : ' No capitulation yet — the desk waits for a seller who has to sell.'}
          </p>
        </div>
        <div>
          <div className="lbl lbl--ink" style={{ marginBottom: '0.4rem' }}>The Second-Level Gate</div>
          <p className="gear__note">
            No lead reaches the docket without a written answer to three questions: what does
            consensus believe, why is it wrong, and what is the kill condition? A lead missing any
            of the three is <b>HELD</b> — a trending name with no articulated edge and no exit is not
            an idea, it is a story. The gate is where stories are turned away.
          </p>
        </div>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Catalyst</th>
              <th>Type</th>
              <th className="r">Forced</th>
              <th>Consensus → Why Wrong → Kill</th>
              <th className="r">Conv.</th>
              <th>Gate</th>
            </tr>
          </thead>
          <tbody>
            {leads.map((l) => (
              <tr key={l.key} style={l.gate === 'HELD' ? { color: 'var(--limestone)' } : undefined}>
                <td>
                  {l.name}
                  <div className="proxy__bounds mono">{l.sector}</div>
                </td>
                <td className="mono">{l.type}</td>
                <td className="r mono">{l.forced ? 'yes' : '—'}</td>
                <td>
                  {l.gate === 'PASS' ? (
                    <span className="gear__note" style={{ margin: 0 }}>
                      <b>Consensus:</b> {l.consensus} <b>Wrong:</b> {l.whyWrong} <b>Kill:</b> {l.kill}
                    </span>
                  ) : (
                    <span className="gear__note" style={{ margin: 0 }}>
                      Incomplete — missing {l.missing.join(', ')}.
                    </span>
                  )}
                </td>
                <td className="r num">{l.gate === 'PASS' ? l.conviction : '—'}</td>
                <td className={`mono ${l.gate === 'PASS' ? 'pos' : 'neg'}`}>{l.gate}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="footnote">
        Catalysts fire off the cycle state; forced-seller intensity scales the conviction of
        contrarian trades. Passing leads are folded into the ranked docket above; held leads wait
        for a thesis. Nothing here is sized — the sourcing engine only decides what is worth
        looking at.
      </p>
    </div>
  )
}
