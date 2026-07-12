import { SLEEVES, MANDATE_SPLIT, CORE_SLEEVES, creditWeightsFor } from '../engine/cycle.js'
import { CORE_GROSS } from '../engine/risk.js'

// The two mandates, side by side. THE DECOUPLING made visible: the Core's
// column never moves; the Credit column breathes with the dial. The dial
// values shown in the anchor table are the credit mandate's internal
// allocation (creditWeightsFor), not the old whole-book anchors.
const CREDIT_SLEEVES = SLEEVES.filter((s) => s.mandate === 'credit')

export default function Allocation({ dial, houseW, creditW }) {
  return (
    <div className="grid-hero">
      <div className="panel">
        <h3 className="panel__title">Firm Capital — Fixed Split, Two Jurisdictions</h3>

        <div className="sleeve">
          <div className="sleeve__head">
            <span className="sleeve__name">AP All Weather Core — fixed {CORE_GROSS.toFixed(1)}× gross, no dial input</span>
            <span className="mono" style={{ color: 'var(--bronze)' }}>Bridgewater</span>
          </div>
          <div className="barrow">
            <span className="lbl">Capital</span>
            <span className="barrow__track">
              <i className="barrow__fill barrow__fill--risk" style={{ width: `${MANDATE_SPLIT.core}%` }} />
            </span>
            <span className="mono num r">{MANDATE_SPLIT.core}%</span>
          </div>
        </div>

        <div className="sleeve">
          <div className="sleeve__head">
            <span className="sleeve__name">AP Cycle Credit — sized by the dial ({dial})</span>
            <span className="mono" style={{ color: 'var(--bronze)' }}>Oaktree · Marks</span>
          </div>
          <div className="barrow">
            <span className="lbl">Capital</span>
            <span className="barrow__track">
              <i className="barrow__fill barrow__fill--capital" style={{ width: `${MANDATE_SPLIT.credit}%` }} />
            </span>
            <span className="mono num r">{MANDATE_SPLIT.credit}%</span>
          </div>
        </div>

        <div style={{ marginTop: 'var(--space-2)' }}>
          {SLEEVES.map((s, k) => (
            <div className="sleeve" key={s.name}>
              <div className="sleeve__head">
                <span className="sleeve__name">{s.name}</span>
                <span className="mono" style={{ color: 'var(--bronze)' }}>{s.engine}</span>
              </div>
              <div className="barrow">
                <span className="lbl">Weight</span>
                <span className="barrow__track">
                  <i
                    className={`barrow__fill barrow__fill--${s.mandate === 'core' ? 'risk' : 'capital'}`}
                    style={{ width: `${houseW[k]}%` }}
                  />
                </span>
                <span className="mono num r">{houseW[k]}%</span>
              </div>
            </div>
          ))}
        </div>

        <p className="footnote">
          The split between mandates is fixed — each is a separate product with its own risk
          promise. Core sleeves ({CORE_SLEEVES.join('/')}%) never move with the cycle; only the
          credit sleeves breathe. The 22-year proving ground showed the old dial-levers-everything
          coupling cost return, volatility, and drawdown at once — one factor, counted twice.
        </p>
      </div>

      <div className="panel panel--quiet">
        <h3 className="panel__title">Cycle Credit Internals at Dial {dial}</h3>
        {CREDIT_SLEEVES.map((s, k) => (
          <div className="sleeve" key={s.name}>
            <div className="sleeve__head">
              <span className="sleeve__name">{s.name}</span>
              <span className="mono" style={{ color: 'var(--bronze)' }}>{s.engine}</span>
            </div>
            <div className="barrow">
              <span className="lbl">Weight</span>
              <span className="barrow__track">
                <i className="barrow__fill barrow__fill--capital" style={{ width: `${creditW[k]}%` }} />
              </span>
              <span className="mono num r">{creditW[k]}%</span>
            </div>
          </div>
        ))}

        <div className="table-wrap" style={{ marginTop: 'var(--space-2)' }}>
          <table>
            <thead>
              <tr>
                <th>Credit sleeve</th>
                <th className="r">Def · 20</th>
                <th className="r">Neu · 50</th>
                <th className="r">Off · 80</th>
              </tr>
            </thead>
            <tbody>
              {CREDIT_SLEEVES.map((s, k) => (
                <tr key={s.name}>
                  <td>{s.name}</td>
                  {[20, 50, 80].map((d) => (
                    <td key={d} className="r num">{creditWeightsFor(d)[k]}%</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="footnote">
          The dial keeps the posture curve it always had — defense hoards powder, offense deploys
          into despair — scoped to the book it actually measures. Distressed deployment still
          requires ≥ 2 armed triggers; risk is judged Oaktree-style, drawdown and permanent loss.
        </p>
      </div>
    </div>
  )
}
