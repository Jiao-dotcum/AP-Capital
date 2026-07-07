# Backend — Phase 0 + 1 (self-running FRED data)

This is the first slice of the backend migration (see the scoping doc): the
macro compass updates itself from a scheduled server job instead of a browser
button-click, and the reading persists point-in-time in Postgres.

Until you provision the database and deploy, **nothing changes** — the app
falls back to its existing simulated / manual-live paths. The endpoints return
`{ configured: false }` and the client ignores them.

## What was added

- `api/ingest.js` — Vercel Cron target. Fetches FRED's keyless `fredgraph.csv`
  directly (no CORS server-side, no API key, no LLM), reuses the same parser as
  `src/live/fred.js`, and appends the observations + one machine-state snapshot.
- `api/state.js` — read endpoint the dashboard calls on load.
- `api/_lib/db.js` — Postgres (via `pg`); works with Neon, Supabase, or Vercel
  Postgres through `DATABASE_URL`. Append-only `observations` + `machine_state`
  tables, created on first run. All calls no-op when `DATABASE_URL` is unset.
- `api/_lib/ingest.js` — the pure `fredCsvToState(csv, knownAt)` transform
  (unit-tested) plus a thin network wrapper.
- `src/live/backend.js` + a mount effect in `App.jsx` — auto-loads the state,
  live by default, with an "as of" timestamp.
- `vercel.json` — daily cron at 13:00 UTC hitting `/api/ingest`.

## Go-live (the steps that need your accounts)

1. **Provision Postgres.** Create a database on [Neon](https://neon.tech)
   (recommended — serverless, free tier, branchable), Supabase, or Vercel
   Postgres. Copy its connection string.
2. **Set environment variables** in the Vercel project (Settings → Environment
   Variables), for Production (and Preview if you want):
   - `DATABASE_URL` = the Postgres connection string (must allow TLS).
   - `CRON_SECRET` = any long random string (Vercel sends it to the cron; the
     ingest endpoint requires it once set, so set it before go-live).
3. **Deploy.** Push to the branch Vercel builds. `pg` installs automatically.
4. **Seed once.** Trigger the first ingest so there's data before the next cron:
   `curl -H "Authorization: Bearer $CRON_SECRET" https://<your-app>/api/ingest`
   You should get `{ ok: true, configured: true, observationsStored: N }`.
5. **Confirm.** Load the app — the status line should read
   `Feed: live · FRED (auto) · as of …` with no key entered and no button clicked.

## Notes / next steps

- The schema is append-only; revisions land as new rows, so the register stays
  lookahead-proof. Nothing is ever overwritten.
- TLS currently uses `rejectUnauthorized: false` for provider convenience —
  harden to a pinned CA before real capital.
- This slice persists the **macro** state. Phase 2 adds the canonical
  server-side engine run (decisions, blotter, NAV) as hash-chained records;
  Phase 1's market-price feed (real proxy marks) is the next ingestion source.
