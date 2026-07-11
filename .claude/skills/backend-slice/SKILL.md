---
name: backend-slice
description: Add a data source, table, or endpoint to The Complete Machine's serverless backend using the guarded no-op-when-unconfigured pattern with fixture tests. Use for any api/ work — new ingestion feeds, new endpoints, Phase 2+ (canonical engine runs, hash-chained audit), broker integration.
---

# Backend Slice — the guarded ingestion/endpoint pattern

Every backend feature ships **dark**: fully coded, unit-tested against
fixtures, and a graceful no-op until its env vars are set. The owner flips it
on by setting secrets in Vercel and running one seed curl. Never make the
frontend depend on the backend being configured.

## The pattern, in order

### 1. Config guard (`api/_lib/<source>.js`)

```js
export const sourceConfigured = () => Boolean(process.env.SOURCE_KEY)
```

Every exported network/db function checks its guard and returns a neutral
value (`{}`, `null`, `0`) when unconfigured. `api/_lib/db.js` already does
this for `DATABASE_URL` — copy its shape.

### 2. Pure transform + thin fetch wrapper (same file)

Split *parsing* from *fetching* so the parse is testable offline:

```js
export function rawToRecords(json, knownAt) { /* pure, no I/O */ }

export async function fetchSource(now = new Date()) {
  if (!sourceConfigured()) return null
  let res
  try {
    res = await fetch(url, {
      headers: { 'User-Agent': 'the-complete-machine/1.0' },
      signal: AbortSignal.timeout(20_000), // explicit — see "fetch failed"
    })
  } catch (err) {
    // undici hides the real reason in err.cause; surface it or the ingest
    // response says only "fetch failed" and is undebuggable.
    const cause = err?.cause ? `: ${err.cause.code || err.cause.message}` : ''
    throw new Error(`SOURCE fetch failed${cause}`)
  }
  if (!res.ok) throw new Error(`SOURCE HTTP ${res.status}`)
  return rawToRecords(await res.json(), now.toISOString())
}
```

Write down the **units** of every numeric field at the parse site and clamp
plausibility (FRED quotes HY OAS in percent — the ×100-to-bp conversion bug
class). Point-in-time discipline: every record carries `obsDate` (what period
it's for) and `knownAt` (when we learned it).

### 3. Database (`api/_lib/db.js`)

Append-only table + a dedupe unique index so re-running the ingest is safe;
revisions are new rows, never UPDATEs:

```sql
CREATE TABLE IF NOT EXISTS things (
  id BIGSERIAL PRIMARY KEY, ..., known_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS things_dedupe_idx ON things (natural, key, cols);
```

Insert with `ON CONFLICT ... DO NOTHING`; reads use `DISTINCT ON` for
latest-per-key. Every function no-ops without `DATABASE_URL`.

### 4. Ingest handler (`api/ingest.js`)

Each source gets its **own try/catch** writing `out.<source>Error` — one
source failing must not block or mask another. Keep `export const
maxDuration = 30` so fetch-level timeouts fire before the platform kills the
function. Auth: honor `CRON_SECRET` as a Bearer token (Vercel Cron sends it).

### 5. Read endpoint (`api/state.js`) and client (`src/live/backend.js`)

Expose new data as additional fields on `/api/state`; absent when never
fetched. The client returns `null` pieces and `App.jsx` falls back silently —
the app must render identically with zero env vars set.

### 6. Docs (`docs/BACKEND.md`)

Add a go-live subsection: which env vars, where to get the keys, the seed
curl, and **exactly what a healthy response looks like** (the owner pastes
this back as confirmation). Secrets go straight into the Vercel UI — never
into chat, code, or commits; if one leaks, rotate it.

## Testing (this sandbox CANNOT reach the internet or the deployed app)

The egress policy 403-blocks FRED, Alpaca, and even the Vercel app itself.
**Never conclude code is broken from a sandbox network error**, and never
claim the live path works. Instead:

1. **Fixture test the pure transform** — synthetic JSON shaped like the real
   response, assert records/units/edge cases (e.g. a single bar falling back
   to its open).
2. **Intercept `global.fetch`** to verify request shape without network:

```js
process.env.SOURCE_KEY = 'test'
global.fetch = async (url, opts) => {
  console.log(url, JSON.stringify(opts.headers))
  return { ok: true, json: async () => FIXTURE }
}
await fetchSource()
```

3. **No-op test**: unset env vars, import every handler, call it with a mock
   `res` — must return `{configured:false}`-style output, never throw.
4. `node scripts/verify.mjs` — confirms nothing leaked into the client bundle
   (if the client JS size jumps after a backend change, a server dep like
   `pg` got imported outside `api/`).

The live round-trip is confirmed only by the owner's seed curl:

```
curl -H "Authorization: Bearer $CRON_SECRET" https://<app>/api/ingest
```

State that explicitly when handing off, and say what the healthy JSON looks like.
