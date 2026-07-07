import { pitSummary } from '../engine/pit.js'

const fmtKnown = (iso) => iso.replace('T', ' ').slice(0, 16) + 'Z'
const fmtValue = (r) => (r.unit === 'index' ? r.value.toFixed(1) : `${r.value}${r.unit.startsWith('%') ? '%' : ` ${r.unit}`}`)

// The point-in-time register: every live input, stamped with the moment it
// became knowable. Append-only, so nothing here can be rewritten after the
// fact — the provenance that makes a later backtest lookahead-proof.
export default function Provenance({ store }) {
  const rows = pitSummary(store)
  return (
    <div className="panel panel--quiet" style={{ marginTop: 'var(--space-3)' }}>
      <div className="lbl lbl--ink" style={{ textAlign: 'center', marginBottom: 'var(--space-2)' }}>
        Point-in-Time Register — As It Was Knowable
      </div>
      {rows.length === 0 ? (
        <p className="footnote" style={{ textAlign: 'center' }}>
          Empty. The register fills when live data is fetched; each observation is stored with the
          timestamp it became knowable, append-only, in this browser.
        </p>
      ) : (
        <>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Series</th>
                  <th className="r">Latest</th>
                  <th className="r">Observed</th>
                  <th className="r">Knowable At</th>
                  <th className="r">Source</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.series}>
                    <td>
                      {r.label} <span className="mono" style={{ opacity: 0.6 }}>{r.series}</span>
                    </td>
                    <td className="r num">{fmtValue(r)}</td>
                    <td className="r mono">{r.obsDate}</td>
                    <td className="r mono">{fmtKnown(r.knownAt)}</td>
                    <td className="r mono">{r.source}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="footnote" style={{ textAlign: 'center' }}>
            {store.records.length} observation{store.records.length === 1 ? '' : 's'} retained ·
            append-only · revisions arrive as new records, never overwrites.
          </p>
        </>
      )}
    </div>
  )
}
