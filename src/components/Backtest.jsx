// The walk-forward proving ground: rules frozen at T, graded at T+1,
// repeated across twenty-two simulated years. Opinions become base rates.
export default function Backtest({ report }) {
  const { years, months, principles, regimes, dial, turnover, book, deadband } = report
  return (
    <div className="panel panel--quiet" style={{ marginTop: 'var(--space-3)' }}>
      <div className="lbl lbl--ink" style={{ textAlign: 'center', marginBottom: 'var(--space-2)' }}>
        The Proving Ground — {years}-Year Walk-Forward
      </div>

      <div className="grid-2 grid-2--top">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Principle</th>
                <th className="r">Fired</th>
                <th className="r">Hit Rate</th>
              </tr>
            </thead>
            <tbody>
              {principles.map((p) => (
                <tr key={p.id}>
                  <td>
                    <span className="mono">{p.id}</span> — {p.then}
                  </td>
                  <td className="r num">{p.fires}×</td>
                  <td className="r num">{p.hitRate === null ? '—' : `${p.hitRate}%`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Regime Call</th>
                <th className="r">Months</th>
                <th className="r">Beat Baseline</th>
              </tr>
            </thead>
            <tbody>
              {regimes.map((r) => (
                <tr key={r.key}>
                  <td>{r.label}</td>
                  <td className="r num">{r.n}</td>
                  <td className="r num">{r.hitRate === null ? '—' : `${r.hitRate}%`}</td>
                </tr>
              ))}
              <tr>
                <td>Dial — Offense preceded tightening</td>
                <td className="r num">{dial.offense.n}</td>
                <td className="r num">{dial.offense.hitRate === null ? '—' : `${dial.offense.hitRate}%`}</td>
              </tr>
              <tr>
                <td>Dial — Defense preceded widening</td>
                <td className="r num">{dial.defense.n}</td>
                <td className="r num">{dial.defense.hitRate === null ? '—' : `${dial.defense.hitRate}%`}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <p className="footnote" style={{ textAlign: 'center' }}>
        {months} graded releases, rules frozen at T against data knowable at T, scored strictly at
        T+1. Dial-managed book: {book.cagr}%/yr at {book.vol}% vol, max drawdown {book.maxDD}%
        (fixed mid-dial book {book.cagrFixed}%/yr). Turnover {turnover.settled}pp per release with
        the ±{deadband} deadband against {turnover.unsettled}pp without. Simulated world, model
        assumptions throughout — the harness measures the rules, not the future.
      </p>
    </div>
  )
}
