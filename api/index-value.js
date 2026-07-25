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
