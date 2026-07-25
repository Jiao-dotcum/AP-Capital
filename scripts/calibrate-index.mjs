#!/usr/bin/env node
// ————— APCCI anchor calibration (v1.1) —————
// Pulls the FULL history of every APCCI input from FRED, computes the real
// empirical distribution of each series, and emits anchor tables in which a
// component's score IS its historical percentile. That turns the index from
// "calibrated to remembered episodes" (v1.0, honestly flagged as such in
// docs/APCCI_METHODOLOGY.md §4) into "the historical percentile of credit
// conditions" — a definition a stranger can check.
//
// WHY THIS IS A SCRIPT AND NOT PART OF THE INGEST:
// Calibration must happen ONCE, be reviewed by a human, and then be frozen
// into the spec as a new INDEX_VERSION. An index that silently recalibrates
// itself as data arrives is an index whose history cannot be reproduced —
// yesterday's published value would no longer follow from today's rules.
// So this prints anchors for a human to paste; it never writes the spec.
//
// USAGE (needs network access to fred.stlouisfed.org):
//   node scripts/calibrate-index.mjs                 # common overlap window
//   node scripts/calibrate-index.mjs --from 1997-01-01
//   node scripts/calibrate-index.mjs --fixture <file>  # offline, for tests
//
// This dev sandbox blocks FRED by policy (403 CONNECT), so run it from a
// machine with plain internet access, or anywhere the deployed backend runs.
import { readFileSync } from 'fs'
import { parseFredCsv } from '../src/live/fred.js'
import { COMPONENTS } from '../src/engine/creditIndex.js'

// The percentile ladder the anchors are placed on. Score == percentile, so
// the index reads directly as "conditions are at the Nth percentile of
// everything observed since the calibration start date."
const LADDER = [0, 5, 10, 25, 50, 75, 90, 95, 100]

// Series that FRED quotes in percent and the index uses in bp (see the units
// rule in CLAUDE.md — the conversion belongs at the parse site).
const PERCENT_TO_BP = new Set(['BAMLH0A0HYM2', 'BAMLH0A3HYC', 'BAMLC0A0CM'])

const arg = (flag, fallback = null) => {
  const k = process.argv.indexOf(flag)
  return k > -1 && process.argv[k + 1] ? process.argv[k + 1] : fallback
}

// Exact percentile by linear interpolation between order statistics — the
// standard definition, so anyone recomputing this gets the same numbers.
export function percentile(sorted, p) {
  if (!sorted.length) return null
  if (p <= 0) return sorted[0]
  if (p >= 100) return sorted[sorted.length - 1]
  const idx = (p / 100) * (sorted.length - 1)
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  return lo === hi ? sorted[lo] : sorted[lo] + (idx - lo) * (sorted[hi] - sorted[lo])
}

// Anchors must be STRICTLY ascending in raw value or interpolate() breaks.
// A flat stretch of the distribution (common at the tails of a bounded
// series) can repeat a value across ladder points; collapse those, keeping
// the highest percentile so the mapping stays conservative — it never
// reports more distress than the data supports.
export function anchorsFrom(sorted, ladder = LADDER, round = (v) => v) {
  const points = ladder.map((p) => [round(percentile(sorted, p)), p])
  const out = []
  for (const [raw, score] of points) {
    if (out.length && raw <= out[out.length - 1][0]) {
      out[out.length - 1][1] = score // same raw value, take the higher percentile
      continue
    }
    out.push([raw, score])
  }
  return out
}

async function fetchSeries(ids, from) {
  const url = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${ids.join(',')}&cosd=${from}`
  const res = await fetch(url, { signal: AbortSignal.timeout(60_000) })
  if (!res.ok) throw new Error(`FRED HTTP ${res.status}`)
  return res.text()
}

async function main() {
  const ids = COMPONENTS.map((c) => c.series)
  const fixture = arg('--fixture')
  const from = arg('--from', '1900-01-01')

  let csv
  if (fixture) {
    csv = readFileSync(fixture, 'utf8')
  } else {
    try {
      csv = await fetchSeries(ids, from)
    } catch (err) {
      const cause = err?.cause ? `: ${err.cause.code || err.cause.message || err.cause}` : ''
      console.error(`\nFRED fetch failed${cause}\n${err.message}`)
      console.error('\nThis sandbox blocks fred.stlouisfed.org by policy. Run this from a')
      console.error('machine with plain internet access. Nothing was written.\n')
      process.exit(2)
    }
  }

  const parsed = parseFredCsv(csv)
  const series = {}
  for (const c of COMPONENTS) {
    const rows = parsed[c.series] ?? []
    const toUnit = PERCENT_TO_BP.has(c.series) ? (v) => v * 100 : (v) => v
    series[c.key] = { spec: c, rows: rows.map((o) => ({ date: o.date, value: toUnit(o.value) })) }
  }

  const missing = Object.values(series).filter((s) => s.rows.length < 500)
  if (missing.length) {
    console.error(`\nInsufficient history for: ${missing.map((s) => s.spec.series).join(', ')}`)
    console.error('Calibration needs the full series. Nothing was written.\n')
    process.exit(2)
  }

  // Common overlapping window: percentiles are only comparable across
  // components if they describe the same period. Using each series' own full
  // history would mix a 1971-start conditions index with a 1996-start spread
  // series and call the result one index.
  const startCommon = Object.values(series).map((s) => s.rows[0].date).sort().pop()
  const endCommon = Object.values(series).map((s) => s.rows[s.rows.length - 1].date).sort()[0]
  console.log(`\nAPCCI calibration — common window ${startCommon} → ${endCommon}`)
  console.log(`Percentile ladder: ${LADDER.join(', ')}\n`)

  const emitted = []
  for (const c of COMPONENTS) {
    const s = series[c.key]
    const win = s.rows.filter((o) => o.date >= startCommon && o.date <= endCommon)
    const sorted = win.map((o) => o.value).sort((a, b) => a - b)
    const round = c.unit === 'bp' ? (v) => Math.round(v) : (v) => +v.toFixed(2)
    const anchors = anchorsFrom(sorted, LADDER, round)
    emitted.push({ key: c.key, series: c.series, anchors })
    console.log(`${c.series} (${c.label}) — n=${sorted.length}, ${c.unit}`)
    console.log(`  min ${round(sorted[0])}  p25 ${round(percentile(sorted, 25))}  median ${round(percentile(sorted, 50))}  p75 ${round(percentile(sorted, 75))}  p95 ${round(percentile(sorted, 95))}  max ${round(sorted[sorted.length - 1])}`)
    console.log(`  anchors: [${anchors.map(([r, p]) => `[${r}, ${p}]`).join(', ')}]\n`)
  }

  console.log('— Paste into src/engine/creditIndex.js as the v1.1.0 COMPONENTS anchors —\n')
  for (const e of emitted) {
    console.log(`  // ${e.series}: score == historical percentile, ${startCommon}→${endCommon}`)
    console.log(`  anchors: [${e.anchors.map(([r, p]) => `[${r}, ${p}]`).join(', ')}],`)
  }
  console.log(`\nThen set INDEX_VERSION = '1.1.0' and record the window + ladder in`)
  console.log(`docs/APCCI_METHODOLOGY.md §4. Do NOT recompute published 1.0.0 values.\n`)
}

if (import.meta.url === `file://${process.argv[1]}`) main()
