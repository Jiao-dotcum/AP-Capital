import { windowStats } from '../engine/backtest.js'
import { positionsLedger, bookNav, START_NAV } from '../engine/oms.js'
import { toneOf } from '../engine/grades.js'

const money = (n) => (n < 0 ? '−$' : '$') + Math.abs(Math.round(n)).toLocaleString()
const signed = (n) => (n >= 0 ? '+$' : '−$') + Math.abs(Math.round(n)).toLocaleString()
const pct = (n) => `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(1)}%`
const GRADE_COLOR = { pos: 'var(--laurel)', '': 'var(--ink)', muted: 'var(--bronze)', neg: 'var(--terracotta)' }

// ————— The tearsheet —————
// A one-page printable account of the machine: posture, strategy record,
// holdings with grades, and the memo's synthesis. Hidden on screen; the
// Print button stamps `print-tearsheet` on <body> so @media print shows this
// and nothing else. Every figure is simulated / paper — the banner says so
// twice, because a tearsheet that lets simulated returns read as real ones
// is worse than no tearsheet.
export default function Tearsheet({ current, dial, posture, regime, book, grades, baseRates, memo, weights }) {
  const w10 = windowStats(baseRates.series.managed, 10)
  const nav = bookNav(book)
  const positions = positionsLedger(book)
  const totalPnl = nav - START_NAV
  const today = new Date().toISOString().slice(0, 10)

  return (
    <div className="tearsheet" aria-hidden="true">
      <div className="ts-banner">
        SIMULATED &amp; PAPER FIGURES ONLY — model assumptions throughout · not an offer of
        securities · not investment advice
      </div>

      <header className="ts-head">
        <div>
          <div className="ts-title">THE COMPLETE MACHINE</div>
          <div className="ts-sub">Bridgewater × Oaktree · autonomous fund diagnostic — paper tearsheet</div>
        </div>
        <div className="ts-date mono">{today}</div>
      </header>

      <div className="ts-grid">
        <div className="ts-cell">
          <div className="ts-lbl">Aggressiveness Dial</div>
          <div className="ts-fig">{dial} / 100 · {posture.word}</div>
        </div>
        <div className="ts-cell">
          <div className="ts-lbl">Regime</div>
          <div className="ts-fig ts-fig--small">{regime.label}</div>
        </div>
        <div className="ts-cell">
          <div className="ts-lbl">Paper NAV</div>
          <div className="ts-fig">{money(nav)} <span className="ts-note">({signed(totalPnl)} since inception)</span></div>
        </div>
        <div className="ts-cell">
          <div className="ts-lbl">Sleeves (β / α / credit / opp / powder)</div>
          <div className="ts-fig ts-fig--small mono">{weights.join(' / ')}%</div>
        </div>
      </div>

      <div className="ts-section">
        <div className="ts-lbl">Strategy Record — 10-Year Walk-Forward (SIMULATED)</div>
        <table className="ts-table">
          <thead>
            <tr><th>CAGR</th><th>Cumulative</th><th>Growth of $10k</th><th>Vol</th><th>Max DD</th><th>Sharpe</th></tr>
          </thead>
          <tbody>
            <tr>
              <td>{pct(w10.cagr)}</td>
              <td>{pct(w10.cumulative)}</td>
              <td>{money(w10.growthOf)}</td>
              <td>{w10.vol}%</td>
              <td>−{w10.maxDD}%</td>
              <td>{w10.sharpe.toFixed(2)}</td>
            </tr>
          </tbody>
        </table>
        <div className="ts-note">
          Time-weighted (annualized HPR), rules frozen at T and graded at T+1 against a
          model-consistent return generator. A simulated walk-forward is a measurement of the
          rules, not a record of anyone&apos;s money.
        </div>
      </div>

      {positions.length > 0 && (
        <div className="ts-section">
          <div className="ts-lbl">Paper Holdings &amp; Grades</div>
          <table className="ts-table">
            <thead>
              <tr><th>Holding</th><th>Grade</th><th className="r">Weight</th><th className="r">Mkt Val</th><th className="r">Unrealized</th></tr>
            </thead>
            <tbody>
              {positions.map((p) => (
                <tr key={p.id}>
                  <td>{p.name}</td>
                  <td style={grades?.[p.id] ? { color: GRADE_COLOR[toneOf(grades[p.id].letter)], fontWeight: 600 } : undefined}>
                    {grades?.[p.id]?.letter ?? '—'}
                  </td>
                  <td className="r">{(p.weight * 100).toFixed(0)}%</td>
                  <td className="r">{money(p.mv)}</td>
                  <td className="r">{signed(p.upnl)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="ts-section">
        <div className="ts-lbl">From the Memo — “{memo.title}” · {memo.quarter}</div>
        <p className="ts-memo">{memo.paragraphs[0]}</p>
      </div>

      <footer className="ts-foot">
        Every figure above is a simulated model assumption or a paper-trading record; no real
        capital is or was invested. This document is not an offer to sell or a solicitation of an
        offer to buy any security, and is not investment advice. Past performance — least of all
        simulated performance — does not indicate future results.
      </footer>
    </div>
  )
}
