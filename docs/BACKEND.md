# Backend — Phase 1 (self-running FRED data + real proxy prices)

This is the backend migration in progress (see the scoping doc): the macro
compass and the paper book's marks update themselves from a scheduled server
job instead of a browser button-click, and everything persists point-in-time
in Postgres.

Until you provision the pieces below, **nothing changes** — the app falls back
to its existing simulated / manual-live / factor-modeled paths. Each piece is
independently optional: FRED alone gets you the live compass; adding Alpaca on
top gets you real closes marking the paper book. The endpoints degrade
gracefully at every stage.

## What was added

**Macro (live)**
- `api/ingest.js` — Vercel Cron target. Fetches FRED's keyless `fredgraph.csv`
  directly (no CORS server-side, no API key, no LLM), reuses the same parser as
  `src/live/fred.js`, and appends the observations + one machine-state snapshot.
- `api/_lib/ingest.js` — the pure `fredCsvToState(csv, knownAt)` transform
  (unit-tested) plus a thin network wrapper.

**Market prices (this slice)**
- `api/_lib/marketdata.js` — pulls daily closes for the 17 listed proxies from
  Alpaca's market-data API (a free paper-account key is enough; IEX feed).
  Pure `barsToPrices(json)` transform (unit-tested) + a thin network wrapper.
  Guarded on `ALPACA_KEY_ID` / `ALPACA_SECRET_KEY` — skipped entirely if unset.
- `src/engine/proxies.js` — the sleeve → ticker map (`usEq → SPY`, `ust10 →
  IEF`, …) and `sleeveReturns(pricesByTicker)`, which turns a ticker-keyed
  price map into the sleeve-keyed % returns the paper book's `reconcile()`
  already accepts.
- The Execution Desk marks positions off real closes when available, falling
  back per-sleeve to the factor model — and says so on screen ("Marks: live
  closes for N of 17 proxies" vs. "factor-modeled").

**Shared**
- `api/state.js` — read endpoint the dashboard calls on load; returns the
  latest macro state and the latest price for every ticker ever fetched.
- `api/_lib/db.js` — Postgres (via `pg`); works with Neon, Supabase, or Vercel
  Postgres through `DATABASE_URL`. Append-only `observations`, `machine_state`,
  and `market_prices` tables, created on first run. Every call no-ops when
  `DATABASE_URL` is unset.
- `src/live/backend.js` + a mount effect in `App.jsx` — auto-loads state and
  prices, live by default, with an "as of" timestamp.
- `vercel.json` — daily cron at 13:00 UTC hitting `/api/ingest`, which now
  pulls FRED and Alpaca independently (one failing doesn't block the other).

## Go-live

### Already done (macro / FRED + Postgres)
Database provisioned, `DATABASE_URL` and `CRON_SECRET` set in Vercel, deployed,
seeded, and confirmed live per the earlier steps. If you haven't done this
yet, do it first — the market-price feed reuses the same database.

### This slice: real proxy prices (Alpaca)

1. **Create an Alpaca account** at [alpaca.markets](https://alpaca.markets) —
   the free paper-trading tier is enough; this only reads market data, no
   money moves. Generate an API key pair (Paper or Live keys both work for
   market data; use **Paper** keys for now to match everything else in the app
   being paper-only).
2. **Set two more environment variables** in Vercel (Production):
   - `ALPACA_KEY_ID`
   - `ALPACA_SECRET_KEY`
3. **Redeploy** (env var changes need a redeploy to take effect).
4. **Seed once**, same endpoint as before:
   ```
   curl -H "Authorization: Bearer $CRON_SECRET" https://<your-app>/api/ingest
   ```
   Look for `"marketConfigured": true` and a non-zero `"tickersFetched"` /
   `"pricesStored"` in the response.
5. **Confirm.** In the Execution Desk (Section XI), click "Rebalance to Target
   (Paper)" — the line above the NAV should read **"Marks: live closes for N
   of 17 proxies (backend feed); the rest factor-modeled."**

### Confirming both together

The full response from a seeded, fully-configured `/api/ingest` looks like:
```json
{
  "ok": true,
  "configured": true,
  "marketConfigured": true,
  "knownAt": "...",
  "prints": { "gdp_now": 2.4, "cpi_yoy": 3.0, "...": "..." },
  "observationsStored": 7,
  "tickersFetched": 17,
  "pricesStored": 17
}
```

## Notes / next steps

- Every table is append-only; revisions land as new rows, so both the macro
  register and the price history stay lookahead-proof. Nothing is ever
  overwritten.
- Alpaca's IEX feed is free and sufficient for daily-close marks. If the book
  ever needs intraday or SIP-consolidated prices, that's a paid Alpaca tier —
  same integration, just a plan upgrade, not a code change.
- TLS currently uses `rejectUnauthorized: false` for provider convenience —
  harden to a pinned CA before real capital.
- **Alpaca is deliberately the market-data vendor** because it's also a
  broker: Phase 4 (real execution) reuses this same integration for order
  routing, so market data and execution consolidate behind one account instead
  of two.
- Phase 2 is next: the canonical server-side engine run (decisions, blotter,
  NAV) as hash-chained records, so the dashboard becomes a pure view onto
  server-computed state rather than each browser tab recomputing locally.
