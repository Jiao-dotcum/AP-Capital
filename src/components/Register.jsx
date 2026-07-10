import { rankIntoTiers } from '../engine/assets.js'
import { toneOf } from '../engine/grades.js'

const TIER_CLASS = { I: 'tier--i', II: '', III: '', IV: 'tier--iv', V: 'tier--v' }
const GRADE_COLOR = { pos: 'var(--laurel)', '': 'var(--ink)', muted: 'var(--bronze)', neg: 'var(--terracotta)' }

// Five tiers, best to worst, re-ranked on every data release, each holding
// carrying its unified grade — the same composite the Origination docket
// ranks by. Ticking a checkbox elects the asset into the working portfolio.
export default function Register({ current, elected, grades, onToggle }) {
  const tiers = rankIntoTiers(current.g, current.i)

  return (
    <div>
      <div className="register">
        {tiers.map((tier) => (
          <div key={tier.numeral} className={`tier ${TIER_CLASS[tier.numeral]}`}>
            <div className="tier__numeral">{tier.numeral}</div>
            <div className="tier__name lbl lbl--ink">{tier.name}</div>
            {tier.assets.map((a) => {
              const grade = grades?.[a.id]
              return (
                <label key={a.id} className="pick">
                  <input
                    type="checkbox"
                    checked={elected.has(a.id)}
                    onChange={() => onToggle(a.id)}
                    aria-label={`Elect ${a.name} into the working portfolio${grade ? `, graded ${grade.letter}` : ''}`}
                  />
                  <span className="pick__name">{a.name}</span>
                  {grade && (
                    <span
                      className="pick__grade mono"
                      style={{ color: GRADE_COLOR[toneOf(grade.letter)] }}
                      title={`Composite conviction ${grade.score} / 100`}
                    >
                      {grade.letter}
                    </span>
                  )}
                  <span className="pick__score">{a.score >= 0 ? '+' : '−'}{Math.abs(a.score).toFixed(2)}</span>
                </label>
              )
            })}
          </div>
        ))}
      </div>
      <p className="footnote" style={{ textAlign: 'center' }}>
        score = β<sub>G</sub>·(growth surprise) + β<sub>I</sub>·(inflation surprise) + carry + (ER −
        cash)/10 · The letter is the unified grade: the composite conviction (regime fit, cycle
        posture, carry, risk-adjusted premium) the Origination docket ranks by — one grade per
        holding, identical in every section. Elected holdings flow to the simulation and ledger
        below.
      </p>
    </div>
  )
}
