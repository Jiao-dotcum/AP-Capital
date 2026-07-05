// Risk parity: four seasonal sleeves, each holding 25% of portfolio RISK,
// with unequal capital weights balanced by leverage. Contrasted with 60/40.

const SLEEVES = [
  { name: 'Rising Growth', assets: 'Equities · Credit · Commodities · EM Debt', capital: 24, risk: 25, lev: '1.6×' },
  { name: 'Falling Growth', assets: 'Nominal Bonds', capital: 41, risk: 25, lev: '2.4×' },
  { name: 'Rising Inflation', assets: 'ILBs · Commodities · Gold', capital: 21, risk: 25, lev: '2.1×' },
  { name: 'Falling Inflation', assets: 'Equities · Nominal Bonds', capital: 14, risk: 25, lev: '1.9×' },
]

const SIXTY_FORTY = [
  { name: 'Equities', capital: 60, risk: 88 },
  { name: 'Bonds', capital: 40, risk: 12 },
]

function BarRow({ label, value, kind, warn }) {
  return (
    <div className="barrow">
      <span className="lbl">{label}</span>
      <span className="barrow__track">
        <i
          className={`barrow__fill barrow__fill--${warn ? 'warn' : kind}`}
          style={{ width: `${value}%` }}
        />
      </span>
      <span className="mono num r">{value}%</span>
    </div>
  )
}

export default function AllWeather() {
  return (
    <div className="grid-2">
      <div className="panel">
        <h3 className="panel__title">All Weather — Four Seasons, Equal Risk</h3>
        <p className="gear__note" style={{ marginBottom: 'var(--space-1)' }}>
          Each environment carries 25% of portfolio risk. Capital weights differ; modest leverage on
          the quiet sleeves equalizes their voice.
        </p>
        {SLEEVES.map((s) => (
          <div className="sleeve" key={s.name}>
            <div className="sleeve__head">
              <span className="sleeve__name">{s.name}</span>
              <span className="mono" style={{ color: 'var(--bronze)' }}>{s.lev} lev</span>
            </div>
            <div className="sleeve__assets">{s.assets}</div>
            <BarRow label="Capital" value={s.capital} kind="capital" />
            <BarRow label="Risk" value={s.risk} kind="risk" />
          </div>
        ))}
      </div>

      <div className="panel panel--terracotta">
        <h3 className="panel__title">The 60/40 Illusion</h3>
        <p className="gear__note" style={{ marginBottom: 'var(--space-1)' }}>
          A 60/40 capital split looks balanced. Weighted by volatility, equities contribute roughly
          nine-tenths of the risk — the bond sleeve is ornamental.
        </p>
        {SIXTY_FORTY.map((s) => (
          <div className="sleeve" key={s.name}>
            <div className="sleeve__head">
              <span className="sleeve__name">{s.name}</span>
            </div>
            <BarRow label="Capital" value={s.capital} kind="capital" />
            <BarRow label="Risk" value={s.risk} kind="risk" warn={s.name === 'Equities'} />
          </div>
        ))}
        <p className="footnote">
          Balance is a property of risk, not of dollars. The seasonal book to the left holds the
          same expected return with roughly one-third the drawdown depth.
        </p>
      </div>
    </div>
  )
}
