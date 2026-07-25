import { configured, getLatestIndexValue, getIndexHistory } from './_lib/db.js'
import { INDEX_NAME, INDEX_TICKER, INDEX_VERSION, INDEX_BASE_DATE, COMPONENTS, bandOf } from '../src/engine/creditIndex.js'

// ————— The published index endpoint (APCCI) —————
// Public and unauthenticated on purpose: an index nobody can read is not an
// index. Returns the latest value with the full component arithmetic behind
// it, so a reader can check the number by hand against FRED rather than
// taking it on trust.
//
//   GET /api/index-value            → latest value + components + methodology
//   GET /api/index-value?history=1  → the full published series
//   GET /api/index-value?spec=1     → the frozen specification only
//
// Values are FINAL. A published observation date is never revised — see
// docs/APCCI_METHODOLOGY.md and the ON CONFLICT DO NOTHING in db.js.

// Pure: the published series as CSV, with a provenance header so a
// downloaded file still says what it is and where the method lives once it
// is detached from this endpoint. Band is quoted (it contains no commas
// today, but a future band name might). Exported so it can be tested
// without a database.
export function toCsv(history, spec, now = new Date()) {
  const lines = [
    '# AP Credit Cycle Index (APCCI)',
    '# scale: 0 = maximum froth, 100 = maximum despair',
    '# published values are final and never revised',
    `# version: ${spec.version} · base date: ${spec.baseDate}`,
    `# methodology: ${spec.methodology}`,
    `# generated: ${now.toISOString()}`,
    '# not investment advice — measures conditions, not returns',
    'obs_date,ticker,version,value,band',
    ...history.map((h) => `${h.obsDate},${h.ticker},${h.version},${h.value},"${String(h.band).replace(/"/g, '""')}"`),
  ]
  return lines.join('\n') + '\n'
}

export default async function handler(req, res) {
  const spec = {
    name: INDEX_NAME,
    ticker: INDEX_TICKER,
    version: INDEX_VERSION,
    baseDate: INDEX_BASE_DATE,
    scale: '0 = maximum froth, 100 = maximum despair',
    revisionPolicy: 'Published values are final and never revised.',
    methodology: 'docs/APCCI_METHODOLOGY.md',
    components: COMPONENTS.map((c) => ({
      key: c.key, series: c.series, label: c.label, unit: c.unit, weight: c.weight, anchors: c.anchors,
    })),
    bands: [0, 20, 35, 65, 80].map((v) => ({ from: v, ...bandOf(v === 0 ? 10 : v) })),
  }
  try {
    if (req.query?.spec === '1') return res.status(200).json({ spec })
    if (!configured()) return res.status(200).json({ configured: false, spec })

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=3600')

    // CSV of the full published series, so a researcher can use the index
    // without scraping a JSON API or a web page. Content-Disposition makes
    // it save as a file rather than render as text.
    if (req.query?.format === 'csv') {
      const history = (await getIndexHistory()) ?? []
      res.setHeader('Content-Type', 'text/csv; charset=utf-8')
      res.setHeader('Content-Disposition', 'attachment; filename="apcci.csv"')
      return res.status(200).send(toCsv(history, spec, new Date()))
    }

    if (req.query?.history === '1') {
      const history = (await getIndexHistory()) ?? []
      return res.status(200).json({ configured: true, spec, count: history.length, history })
    }
    const latest = await getLatestIndexValue()
    return res.status(200).json({ configured: true, spec, latest: latest ?? null })
  } catch (err) {
    return res.status(200).json({ configured: false, spec, error: String(err.message || err) })
  }
}
