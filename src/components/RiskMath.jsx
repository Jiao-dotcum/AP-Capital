// The risk desk's arithmetic, measured rather than assumed: shrunk
// correlations, crisis correlations, four-season risk contributions,
// tail losses, the de-risking schedule, and the named replays.
export default function RiskMath({ report }) {
  if (!report) return null
  const { lw, crisis, rp, boot, replays, schedule } = report
  return (
    <div className="panel panel--quiet" style={{ marginTop: 'var(--space-3)' }}>
      <div className="lbl lbl--ink" style={{ textAlign: 'center', marginBottom: 'var(--space-2)' }}>
        The Risk Desk — Measured, Not Assumed
      </div>

      <div className="grid-2 grid-2--top">
        <div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Season</th>
                  <th className="r">Capital</th>
                  <th className="r">Risk Share</th>
                </tr>
              </thead>
              <tbody>
                {rp.seasons.map((s) => (
                  <tr key={s.name}>
                    <td>{s.name}</td>
                    <td className="r num">{s.capital}%</td>
                    <td className="r num">{s.risk}%</td>
                  </tr>
                ))}
                <tr>
                  <td>Cash {rp.cashW < 0 ? '(borrowed)' : '(unlevered)'}</td>
                  <td className="r num">{Math.round(rp.cashW * 100)}%</td>
                  <td className="r num">—</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="footnote">
            Risk parity on the elected book: equal risk per season, capital falls out. The dial
            scales gross to {rp.gross}× — offense borrows, defense holds cash.
          </p>
          <div className="table-wrap" style={{ marginTop: 'var(--space-2)' }}>
            <table>
              <thead>
                <tr>
                  <th>Drawdown</th>
                  <th className="r">Response</th>
                </tr>
              </thead>
              <tbody>
                {schedule.map((s) => (
                  <tr key={s.beyond}>
                    <td className="mono">&gt; {Math.round(s.beyond * 100)}%</td>
                    <td className="r">{s.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="footnote">
            The de-risking schedule runs inside every bootstrap path and feeds the same hardstop as
            the ruin ceiling in Section XII.
          </p>
        </div>

        <div>
          <div className="table-wrap">
            <table>
              <tbody>
                <tr>
                  <td>Risk-on ρ — full history</td>
                  <td className="r num">{crisis.fullRho}</td>
                </tr>
                <tr>
                  <td>Risk-on ρ — crisis decile ({crisis.months} months)</td>
                  <td className="r num">{crisis.crisisRho}</td>
                </tr>
                <tr>
                  <td>Ledoit–Wolf shrinkage intensity δ</td>
                  <td className="r num">{lw.delta}</td>
                </tr>
                <tr>
                  <td>Expected shortfall, monthly — 95%</td>
                  <td className="r num neg">{boot.es95}%</td>
                </tr>
                <tr>
                  <td>Expected shortfall, monthly — 99%</td>
                  <td className="r num neg">{boot.es99}%</td>
                </tr>
                <tr>
                  <td>Bootstrap max drawdown — median / 95th</td>
                  <td className="r num">
                    {boot.maxDD.median.toFixed(1)}% / {boot.maxDD.p95.toFixed(1)}%
                  </td>
                </tr>
                <tr>
                  <td>Bootstrap terminal, of 100 — 5th / median / 95th</td>
                  <td className="r num">
                    {boot.terminal.p5.toFixed(0)} / {boot.terminal.p50.toFixed(0)} / {boot.terminal.p95.toFixed(0)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <div className="table-wrap" style={{ marginTop: 'var(--space-2)' }}>
            <table>
              <thead>
                <tr>
                  <th>Named Replay</th>
                  <th className="r">Months</th>
                  <th className="r">Book Return</th>
                  <th className="r">Max DD</th>
                </tr>
              </thead>
              <tbody>
                {replays.map((r) => (
                  <tr key={r.name}>
                    <td>{r.name}</td>
                    <td className="r num">{r.months}</td>
                    <td className={`r num ${r.total >= 0 ? 'pos' : 'neg'}`}>{r.total}%</td>
                    <td className={`r num ${r.maxDD > 0 ? 'neg' : ''}`}>
                      {r.maxDD > 0 ? `−${r.maxDD}%` : '0%'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="footnote">
            Correlations converge toward one exactly when diversification is needed most — the
            crisis line prices that in. The bootstrap resamples six-month blocks of the actual
            22-year history, so fat tails and correlated months survive; the replays are scripted
            factor paths through the model&apos;s own betas, not historical asset prices.
          </p>
        </div>
      </div>
    </div>
  )
}
