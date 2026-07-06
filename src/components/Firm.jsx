import { LAYERS } from '../engine/firm.js'

// Layer roster, the live decision feed, and the quarterly Memo.
export default function Firm({ feed, memo, vetoCount }) {
  return (
    <div>
      <div className="grid-2">
        <div className="panel panel--quiet">
          <h3 className="panel__title">The Hierarchy — Eight Layers, One Pipeline</h3>
          {LAYERS.map((l) => (
            <div key={l.id} className="layer">
              <span className="layer__id mono">{l.id}</span>
              <div>
                <div className="layer__role">{l.role}</div>
                <div className="gear__note">{l.duty}</div>
              </div>
            </div>
          ))}
          <p className="footnote">
            Decisions flow up; nothing trades without passing every layer. The Error Log stands at{' '}
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
          <div className="lbl">Layer 7 — Memo No. {memo.number} · {memo.quarter}</div>
          <h3 className="memo__title">“{memo.title}”</h3>
        </div>
        {memo.paragraphs.map((p, k) => (
          <p key={k} className="memo__para">
            {p}
          </p>
        ))}
      </div>
    </div>
  )
}
