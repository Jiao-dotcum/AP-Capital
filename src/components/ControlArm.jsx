// ————— The Control Arm —————
// A second Core execution book that runs the SAME strategy with the 2.5%
// risk-of-ruin ceiling switched off. It exists to measure the hardstop
// rather than assume it: the gap between the two NAVs is what the ceiling
// has cost — or saved — since inception, in dollars, on the firm's own data.
//
// It is a MEASUREMENT, not a strategy. It never trades, never feeds the
// Firm's decisions, and is labeled a counterfactual everywhere it appears.
// The distinction matters: a reader who mistook this for a live book would
// think the firm runs an unhedged mandate it does not run.
const money = (v) => `${v < 0 ? '−' : ''}$${Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}`

export default function ControlArm({ journal }) {
  const entries = (journal ?? []).filter((e) => e.shadow)
  const latest = entries[0]?.shadow ?? null

  if (!latest) {
    return (
      <div className="panel panel--quiet">
        <h3 className="panel__title">Control Arm — no measurements yet</h3>
        <p className="gear__note">
          The control arm records once the scheduled backend has sealed a canonical run. Until
          then there is nothing measured, and nothing is claimed.
        </p>
      </div>
    )
  }

  // Sign convention, stated everywhere it is shown: the control arm is the
  // book WITHOUT the ceiling, so a positive gap means the unconstrained book
  // is ahead — the hardstop cost money. Negative means it protected capital.
  const gap = latest.divergence
  const costly = gap > 0

  return (
    <div>
      <div className="panel">
        <h3 className="panel__title">What the Hardstop Has Cost</h3>
        <p className="gear__note" style={{ marginBottom: 'var(--space-2)' }}>
          The same Core strategy, run in parallel with the {`≤`}2.5% risk-of-ruin ceiling
          switched off. Identical targets, identical marks, identical caps — the{' '}
          <strong>only</strong> difference is whether new buys are halted when ruin risk breaches.
          Position caps still bind on both.
        </p>
        <div className="grid-2">
          <div>
            <div className="gear__figure" style={{ color: costly ? 'var(--terracotta)' : 'var(--laurel)' }}>
              {money(gap)}
              <span className="lbl lbl--bronze">
                {' '}
                {costly ? 'the ceiling has cost' : 'the ceiling has saved'}
              </span>
            </div>
            <p className="footnote" style={{ marginTop: 'var(--space-1)' }}>
              {latest.divergencePct >= 0 ? '+' : '−'}
              {Math.abs(latest.divergencePct).toFixed(3)}% of NAV, cumulative since inception.
            </p>
          </div>
          <div>
            <table>
              <tbody>
                <tr>
                  <td>Canonical book (ceiling on)</td>
                  <td className="r num">{money(latest.navEnd - gap)}</td>
                </tr>
                <tr>
                  <td>Control arm (ceiling off)</td>
                  <td className="r num">{money(latest.navEnd)}</td>
                </tr>
                <tr>
                  <td>Days the ceiling halted buying</td>
                  <td className="r num">{latest.haltedDays}</td>
                </tr>
                <tr>
                  <td>Halted today</td>
                  <td className="r num">{latest.haltedToday ? 'YES' : 'no'}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
        <p className="footnote">
          A positive figure means the unconstrained book is ahead and the ceiling has cost return;
          negative means it protected capital. One number over a short record proves nothing —
          the hardstop earns its keep in the tail, and a sample without a severe drawdown in it
          cannot price that. Read this as accumulating evidence, not a verdict.
        </p>
      </div>

      <div className="panel panel--quiet" style={{ marginTop: 'var(--space-3)' }}>
        <h3 className="panel__title">Control-Arm Journal</h3>
        <p className="gear__note" style={{ marginBottom: 'var(--space-1)' }}>
          One row per sealed run, newest first. Every figure is hash-chained with the canonical
          record it is measured against.
        </p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Run</th>
                <th>Date</th>
                <th className="r">Canonical NAV</th>
                <th className="r">Control NAV</th>
                <th className="r">Gap</th>
                <th className="r">Filled</th>
                <th>Ceiling</th>
              </tr>
            </thead>
            <tbody>
              {entries.slice(0, 20).map((e) => (
                <tr key={e.seq}>
                  <td className="mono">{e.seq}</td>
                  <td className="mono">{String(e.knownAt).slice(0, 10)}</td>
                  <td className="r num">{money(e.nav)}</td>
                  <td className="r num">{money(e.shadow.navEnd)}</td>
                  <td className={`r num ${e.shadow.divergence > 0 ? 'neg' : e.shadow.divergence < 0 ? 'pos' : ''}`}>
                    {money(e.shadow.divergence)}
                  </td>
                  <td className="r num">{e.shadow.filled}</td>
                  <td className="mono" style={{ color: e.shadow.haltedToday ? 'var(--terracotta)' : 'var(--limestone)' }}>
                    {e.shadow.haltedToday ? 'HALTED' : 'open'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="footnote">
          Counterfactual only. This book does not exist, holds no capital, and is not investment
          advice — it is a control against which the live risk rule is measured.
        </p>
      </div>
    </div>
  )
}
