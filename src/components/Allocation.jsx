import { SLEEVES, ANCHORS } from '../engine/cycle.js'

const SLEEVE_KIND = ['risk', 'risk', 'risk', 'risk', 'capital']

// The unified book: five sleeves, weights modulated by the dial.
export default function Allocation({ weights, dial }) {
  return (
    <div className="grid-hero">
      <div className="panel">
        <h3 className="panel__title">The Unified Book at Dial {dial}</h3>
        {SLEEVES.map((s, k) => (
          <div className="sleeve" key={s.name}>
            <div className="sleeve__head">
              <span className="sleeve__name">{s.name}</span>
              <span className="mono" style={{ color: 'var(--bronze)' }}>{s.engine}</span>
            </div>
            <div className="barrow">
              <span className="lbl">Weight</span>
              <span className="barrow__track">
                <i className={`barrow__fill barrow__fill--${SLEEVE_KIND[k]}`} style={{ width: `${weights[k]}%` }} />
              </span>
              <span className="mono num r">{weights[k]}%</span>
            </div>
          </div>
        ))}
        <p className="footnote">
          Bridgewater diagnoses the environment; Oaktree decides how aggressive to be within it.
          The dial scales the whole book — defense hoards powder, offense spends it.
        </p>
      </div>

      <div className="panel panel--quiet">
        <h3 className="panel__title">Anchor Postures</h3>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Sleeve</th>
                <th className="r">Def · 20</th>
                <th className="r">Neu · 50</th>
                <th className="r">Off · 80</th>
              </tr>
            </thead>
            <tbody>
              {SLEEVES.map((s, k) => (
                <tr key={s.name}>
                  <td>{s.name}</td>
                  {ANCHORS.map((a) => (
                    <td key={a.d} className="r num">{a.w[k]}%</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="footnote">
          Weights interpolate linearly between the anchors; the dial is clamped to [20, 80] for
          allocation purposes. Risk is judged Oaktree-style — drawdown and permanent loss — atop the
          tail hardstop below.
        </p>
      </div>
    </div>
  )
}
