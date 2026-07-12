import { TICKERS } from '../../src/engine/proxies.js'

// ————— Market-data ingestion (Alpaca) —————
// Real daily closes for the listed proxies. Free Alpaca market-data keys (a
// paper account is enough) authorize the IEX feed. Guarded on the keys: with
// them unset the feed is skipped and the app falls back to factor-based marks.
// The same vendor later provides paper/live execution, so market data and the
// broker consolidate behind one integration.

export const marketConfigured = () =>
  Boolean(process.env.ALPACA_KEY_ID && process.env.ALPACA_SECRET_KEY)

// Pure: Alpaca multi-symbol daily-bars JSON → { TICKER: {close, prevClose,
// open, change, intraday, asof} }. `change` is close-over-prior-close — the
// full economic day including the overnight gap, and what the book marks on.
// `intraday` is open→close within the session, journaled alongside so the
// day's tape shows both. Uses the last two daily bars per symbol.
export function barsToPrices(json, asOfFallback) {
  const bars = json?.bars || {}
  const out = {}
  for (const [sym, arr] of Object.entries(bars)) {
    if (!Array.isArray(arr) || !arr.length) continue
    const last = arr[arr.length - 1]
    const prev = arr.length > 1 ? arr[arr.length - 2] : null
    const close = last.c
    const open = last.o
    const prevClose = prev ? prev.c : last.o
    if (!Number.isFinite(close) || !Number.isFinite(prevClose) || prevClose === 0) continue
    out[sym] = {
      close: +close.toFixed(2),
      prevClose: +prevClose.toFixed(2),
      open: Number.isFinite(open) ? +open.toFixed(2) : null,
      change: +((close / prevClose - 1) * 100).toFixed(2),
      intraday: Number.isFinite(open) && open !== 0 ? +((close / open - 1) * 100).toFixed(2) : null,
      asof: last.t || asOfFallback,
    }
  }
  return out
}

export async function fetchPrices(now = new Date()) {
  if (!marketConfigured()) return {}
  const start = new Date(now.getTime() - 12 * 864e5).toISOString().slice(0, 10)
  const url =
    `https://data.alpaca.markets/v2/stocks/bars?symbols=${TICKERS.join(',')}` +
    `&timeframe=1Day&start=${start}&adjustment=all&feed=iex&limit=1000&sort=asc`
  const res = await fetch(url, {
    headers: {
      'APCA-API-KEY-ID': process.env.ALPACA_KEY_ID,
      'APCA-API-SECRET-KEY': process.env.ALPACA_SECRET_KEY,
      accept: 'application/json',
    },
  })
  if (!res.ok) throw new Error(`Alpaca HTTP ${res.status}`)
  return barsToPrices(await res.json(), now.toISOString())
}
