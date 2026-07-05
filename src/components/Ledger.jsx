import { ledgerRow } from '../engine/montecarlo.js'
import { CASH_RATE } from '../engine/assets.js'

const pct = (v) => `${(v * 100).toFixed(1)}%`

// Analytic returns ledger for the elected holdings.
export default function Ledger({ assets }) {
  if (assets.length === 0) {
    return (
      <div className="panel panel--quiet" style={{ textAlign: 'center' }}>
        <p className="gear__note">The ledger is empty until holdings are elected in the Register.</p>
      </div>
    )
  }
  const rows = assets.map(ledgerRow)

  return (
    <div className="panel">
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Holding</th>
              <th>Class</th>
              <th className="r">Expected CAGR</th>
              <th className="r">Vol σ</th>
              <th className="r">Sharpe</th>
              <th className="r">10-Yr HPR · Median</th>
              <th className="r">10-Yr HPR · 5th Pct</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.name}</td>
                <td className="mono" style={{ color: 'var(--bronze)' }}>{r.cls}</td>
                <td className="r num">{r.er.toFixed(1)}%</td>
                <td className="r num">{r.vol.toFixed(1)}%</td>
                <td className="r num">{r.sharpe.toFixed(2)}</td>
                <td className={`r num ${r.hprMedian >= 0 ? 'pos' : 'neg'}`}>{pct(r.hprMedian)}</td>
                <td className={`r num ${r.hprP5 >= 0 ? 'pos' : 'neg'}`}>{pct(r.hprP5)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="footnote">
        Sharpe = (ER − {CASH_RATE.toFixed(1)}%) / σ. Median 10-yr HPR = e
        <sup>(μ−σ²/2)·10</sup> − 1; the 5th percentile subtracts 1.645·σ·√10 in the exponent
        (lognormal). CAGR, HPR, and Sharpe are the correct measures for liquid, marked-to-market
        assets; IRR is reserved for irregular cash flows — private holdings — which this book does
        not carry.
      </p>
    </div>
  )
}
