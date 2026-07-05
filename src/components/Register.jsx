import { rankIntoTiers } from '../engine/assets.js'

const TIER_CLASS = { I: 'tier--i', II: '', III: '', IV: 'tier--iv', V: 'tier--v' }

// Five tiers, best to worst, re-ranked on every data release. Ticking a
// checkbox elects the asset into the working portfolio.
export default function Register({ current, elected, onToggle }) {
  const tiers = rankIntoTiers(current.g, current.i)

  return (
    <div>
      <div className="register">
        {tiers.map((tier) => (
          <div key={tier.numeral} className={`tier ${TIER_CLASS[tier.numeral]}`}>
            <div className="tier__numeral">{tier.numeral}</div>
            <div className="tier__name lbl lbl--ink">{tier.name}</div>
            {tier.assets.map((a) => (
              <label key={a.id} className="pick">
                <input
                  type="checkbox"
                  checked={elected.has(a.id)}
                  onChange={() => onToggle(a.id)}
                  aria-label={`Elect ${a.name} into the working portfolio`}
                />
                <span className="pick__name">{a.name}</span>
                <span className="pick__score">{a.score >= 0 ? '+' : '−'}{Math.abs(a.score).toFixed(2)}</span>
              </label>
            ))}
          </div>
        ))}
      </div>
      <p className="footnote" style={{ textAlign: 'center' }}>
        score = β<sub>G</sub>·(growth surprise) + β<sub>I</sub>·(inflation surprise) + carry + (ER −
        cash)/10 · Elected holdings flow to the simulation and ledger below.
      </p>
    </div>
  )
}
