import { positionsLedger, bookNav, LIMITS, START_NAV } from '../engine/oms.js'

const money = (n) => (n < 0 ? '−$' : '$') + Math.abs(Math.round(n)).toLocaleString()
const signed = (n) => (n >= 0 ? '+' : '−') + '$' + Math.abs(Math.round(n)).toLocaleString()

// The Execution Desk: a paper-trading OMS. Own notional capital, listed
// proxies, simulated fills — the Charter forbids real-money and outside-money
// automation. Pre-trade compliance vetoes an order exactly as the Layer-4 risk
// agent vetoes a trade; the blotter is the audit trail, persisted in-browser.
export default function Execution({ book, onRebalance, onReset, canTrade, ruinBreached, livePriceCount = 0 }) {
  const nav = bookNav(book)
  const positions = positionsLedger(book)
  const gross = positions.reduce((s, p) => s + Math.abs(p.mv), 0)
  const unreal = positions.reduce((s, p) => s + p.upnl, 0)
  const totalPnl = nav - START_NAV
  const hist = book.history

  return (
    <div>
      <div className="panel">
        <div className="dial__override-row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
          <h3 className="panel__title" style={{ margin: 0 }}>Paper Book — Positions, P&amp;L, NAV</h3>
          <div className="dial__override-row" style={{ gap: '0.5rem' }}>
            <button type="button" className="btn btn--small" onClick={onRebalance} disabled={!canTrade}>
              Rebalance to Target (Paper)
            </button>
            <button type="button" className="btn btn--outline btn--small" onClick={onReset}>
              Reset Book
            </button>
          </div>
        </div>
        <p className="footnote" style={{ marginTop: '0.5rem' }}>
          {livePriceCount > 0 ? (
            <span className="lbl lbl--laurel">
              Marks: live closes for {livePriceCount} of 17 proxies (backend feed); the rest factor-modeled.
            </span>
          ) : (
            <span className="lbl">Marks: factor-modeled — no live price feed configured yet.</span>
          )}
        </p>

        <div className="grid-hero" style={{ marginTop: 'var(--space-2)' }}>
          <div>
            <div className="lbl">Net Asset Value</div>
            <div className="gear__figure" style={{ marginBottom: 0 }}>
              {money(nav)}
              <span className={`lbl ${totalPnl >= 0 ? 'lbl--laurel' : 'lbl--terracotta'}`}>
                {' '}{signed(totalPnl)} since inception
              </span>
            </div>
            <p className="gear__note" style={{ marginTop: '0.4rem' }}>
              Cash {money(book.cash)} · gross {(gross / nav * 100).toFixed(0)}% of NAV · unrealized{' '}
              {signed(unreal)} · realized {signed(book.realized)}.
              {ruinBreached && <b style={{ color: 'var(--terracotta)' }}> Ruin ceiling breached — new risk halted.</b>}
            </p>
          </div>
          <div>
            <div className="lbl">Pre-Trade Compliance</div>
            <ul className="gear__note" style={{ margin: '0.4rem 0 0', paddingLeft: '1.1rem' }}>
              <li>Single name ≤ {(LIMITS.maxName * 100).toFixed(0)}% NAV</li>
              <li>Asset class ≤ {(LIMITS.maxClass * 100).toFixed(0)}% NAV</li>
              <li>Gross ≤ {LIMITS.grossCeiling}× NAV</li>
              <li>Buys halted while the ruin ceiling is breached; sells always clear</li>
            </ul>
          </div>
        </div>
      </div>

      <div className="grid-2" style={{ marginTop: 'var(--space-3)' }}>
        <div className="panel panel--quiet">
          <h3 className="panel__title">Positions Ledger</h3>
          {positions.length === 0 ? (
            <p className="gear__note">
              Flat. {canTrade ? 'Rebalance to build the paper book from the risk-parity target.' : 'Elect a book in the Register to enable trading.'}
            </p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Holding</th>
                    <th className="r">Qty</th>
                    <th className="r">Avg</th>
                    <th className="r">Mark</th>
                    <th className="r">Mkt Val</th>
                    <th className="r">Unreal.</th>
                    <th className="r">Wt</th>
                  </tr>
                </thead>
                <tbody>
                  {positions.map((p) => (
                    <tr key={p.id}>
                      <td>
                        {p.name}
                        <div className="proxy__bounds mono">{p.cls}</div>
                      </td>
                      <td className="r num">{p.qty.toLocaleString()}</td>
                      <td className="r num">{p.avgCost.toFixed(1)}</td>
                      <td className="r num">{p.mark.toFixed(1)}</td>
                      <td className="r num">{money(p.mv)}</td>
                      <td className={`r num ${p.upnl >= 0 ? 'pos' : 'neg'}`}>{signed(p.upnl)}</td>
                      <td className="r num">{(p.weight * 100).toFixed(0)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="footnote">
            Marks move with the macro reading through each proxy&apos;s factor betas; the book is
            reconciled to NAV on every rebalance. Paper fills slip 4 bp against the taker.
          </p>
        </div>

        <div className="panel panel--quiet">
          <h3 className="panel__title">The Blotter — Audit Trail</h3>
          {book.blotter.length === 0 ? (
            <p className="gear__note">No orders yet. The blotter records every fill and every compliance veto, persisted in this browser.</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th className="r">#</th>
                    <th>Order</th>
                    <th className="r">Qty</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {book.blotter.slice(0, 12).map((o) => (
                    <tr key={o.seq} style={o.status === 'VETOED' ? { color: 'var(--limestone)' } : undefined}>
                      <td className="r mono">{o.seq}</td>
                      <td>
                        <span className={`mono ${o.side === 'BUY' ? 'pos' : 'neg'}`}>{o.side}</span> {o.name}
                        {o.status === 'VETOED' && <div className="proxy__bounds mono">{o.reason}</div>}
                      </td>
                      <td className="r num">{Math.round(o.qty).toLocaleString()}</td>
                      <td className={`mono ${o.status === 'FILLED' ? 'pos' : 'neg'}`}>{o.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {hist.length > 1 && (
            <p className="footnote">
              NAV path: {hist.slice(-6).map((h) => money(h.nav)).join(' → ')}. Decision feed and blotter
              persist to localStorage as the audit record.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
