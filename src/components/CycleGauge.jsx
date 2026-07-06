import { postureOf } from '../engine/cycle.js'

// Marks' market temperature: seven proxies → despair scores → the
// Aggressiveness Dial. The master risk knob above the macro compass.
export default function CycleGauge({ scores, autoDial, dial, override, onOverride, onResume }) {
  const posture = postureOf(dial)

  return (
    <div className="grid-2 grid-2--top">
      <div className="panel">
        <h3 className="panel__title">The Aggressiveness Dial</h3>
        <div className="dial__figure">
          <span className="gear__figure" style={{ margin: 0 }}>{dial}</span>
          <span className="lbl lbl--bronze"> / 100 — {posture.word}</span>
        </div>

        <div className="dial" role="img" aria-label={`Aggressiveness dial at ${dial} of 100: ${posture.word}`}>
          <div className="dial__track">
            <span className="dial__zoneline" style={{ left: '35%' }} />
            <span className="dial__zoneline" style={{ left: '65%' }} />
            <span className="dial__marker" style={{ left: `${dial}%` }} />
          </div>
          <div className="dial__zones lbl">
            <span>Defense</span>
            <span>Neutral</span>
            <span>Offense</span>
          </div>
        </div>

        <p className="gear__note">{posture.note}</p>

        <div className="dial__override">
          <div className="lbl lbl--ink" style={{ marginBottom: '0.4rem' }}>
            Co-CEO Override — the agents recommend, you ratify
          </div>
          <div className="dial__override-row">
            <input
              type="range"
              min="0"
              max="100"
              value={dial}
              onChange={(e) => onOverride(Number(e.target.value))}
              aria-label="Override the aggressiveness dial"
            />
            <button
              type="button"
              className="btn btn--outline btn--small"
              onClick={onResume}
              disabled={override === null}
            >
              Resume Automatic
            </button>
          </div>
          <p className="footnote" style={{ marginTop: '0.4rem' }}>
            {override === null
              ? `Automatic: the dial is the mean despair score of the seven proxies (currently ${autoDial}).`
              : `Manual override ratified at ${override}; the composite reads ${autoDial}. The divergence is logged.`}
          </p>
        </div>
      </div>

      <div className="panel panel--quiet">
        <h3 className="panel__title">Market Temperature — Seven Proxies</h3>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Input</th>
                <th className="r">Reading</th>
                <th style={{ width: '30%' }}>Froth → Despair</th>
                <th className="r">Score</th>
              </tr>
            </thead>
            <tbody>
              {scores.map((p) => (
                <tr key={p.key}>
                  <td>
                    {p.label}
                    <div className="proxy__bounds mono">{p.froth} · {p.despair}</div>
                  </td>
                  <td className="r num">{p.value}</td>
                  <td>
                    <div className="gear__meter" style={{ margin: 0 }}>
                      <i style={{ width: `${p.score}%` }} />
                    </div>
                  </td>
                  <td className="r num">{p.score}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="footnote">
          Each proxy maps to a 0–100 despair score: 0 at the froth bound, 100 at the despair bound.
          The dial is their mean. You cannot predict the cycle — you can know where you stand in it.
        </p>
      </div>
    </div>
  )
}
