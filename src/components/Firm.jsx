import { LAYERS, firmStandings } from '../engine/firm.js'

// Layer roster, the live decision feed, and the quarterly Memo.
export default function Firm({ feed, memo, vetoCount, live, onConvene, convening, firmStatus }) {
  const standings = firmStandings()
  const scoreOf = Object.fromEntries(standings.map((s) => [s.id, s.score]))
  return (
    <div>
      <div className="grid-2">
        <div className="panel panel--quiet">
          <h3 className="panel__title">The Hierarchy — Artifact, Check, Believability</h3>
          {LAYERS.map((l) => (
            <div key={l.id} className="layer">
              <span className="layer__id mono">{l.id}</span>
              <div style={{ flex: 1 }}>
                <div className="layer__role">
                  {l.role}
                  <span className="num" style={{ float: 'right', color: 'var(--bronze)' }}>{scoreOf[l.id]}%</span>
                </div>
                <div className="gear__note">
                  <b>Owns:</b> {l.artifact}. <b>Checks:</b> {l.check}
                </div>
              </div>
            </div>
          ))}
          <p className="footnote">
            Believability is each layer&apos;s track record on the walk-forward proving ground; IC
            votes are weighted by it. The Error Log stands at{' '}
            <span className="num">{vetoCount}</span> logged veto{vetoCount === 1 ? '' : 'es'} this
            session — Pain + Reflection = Progress.
          </p>
        </div>

        <div className="panel">
          <h3 className="panel__title">Decision Feed — the Firm at Work</h3>
          <div className="feed" role="log" aria-label="Agent decision feed, newest first">
            {feed.map((e) => (
              <div key={e.id} className={`feed__entry feed__entry--${e.tone}`}>
                <span className="feed__chip mono">
                  R{e.n} · {e.layer}
                </span>
                <div>
                  <div className="feed__role lbl lbl--ink">{e.role}</div>
                  <div className="feed__text">{e.text}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="panel memo" style={{ marginTop: 'var(--space-3)' }}>
        <div className="memo__head">
          <div className="lbl">
            Layer 7 — Memo No. {memo.number} · {memo.quarter}
            {live && <span className="memo__livechip"> · convened live</span>}
          </div>
          <h3 className="memo__title">“{memo.title}”</h3>
        </div>
        {memo.paragraphs.map((p, k) => (
          <p key={k} className="memo__para">
            {p}
          </p>
        ))}
        <div className="memo__convene">
          <button type="button" className="btn btn--outline btn--small" onClick={onConvene} disabled={convening}>
            {convening ? 'Convening…' : 'Convene the Firm — Live'}
          </button>
          <p className="footnote" style={{ marginTop: '0.5rem' }}>
            {firmStatus ||
              'With an API key entered above, the committee debate and this memo are written by a live model instead of templates. Failures fall back to the simulated firm.'}
          </p>
        </div>
      </div>
    </div>
  )
}
