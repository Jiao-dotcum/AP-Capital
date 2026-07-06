// The Origination Desk: the machine's ranked nominations for the next
// dollar. Read-only — the docket proposes, the desks and the committee
// dispose.
export default function Origination({ ideas }) {
  return (
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
  )
}
