import pg from 'pg'

// ————— The database seam —————
// A single Postgres connection, shared across warm serverless invocations.
// Everything here is guarded on DATABASE_URL: before the database is
// provisioned, `configured()` is false and every call is a graceful no-op, so
// the app keeps running on its simulated/live-fetch paths until you flip it on.
// Works with any Postgres (Neon, Supabase, Vercel Postgres) via DATABASE_URL.

let _pool = null
export const configured = () => Boolean(process.env.DATABASE_URL)

function pool() {
  if (!configured()) return null
  if (!_pool) {
    _pool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      // Managed Postgres providers require TLS. Harden to a pinned CA later.
      ssl: { rejectUnauthorized: false },
      max: 2,
      idleTimeoutMillis: 10_000,
    })
  }
  return _pool
}

// Idempotent schema. Append-only tables — revisions arrive as new rows, so the
// point-in-time register is lookahead-proof by construction.
const SCHEMA = `
  CREATE TABLE IF NOT EXISTS observations (
    id         BIGSERIAL PRIMARY KEY,
    series     TEXT NOT NULL,
    label      TEXT,
    unit       TEXT,
    value      DOUBLE PRECISION NOT NULL,
    obs_date   DATE NOT NULL,
    known_at   TIMESTAMPTZ NOT NULL,
    source     TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS observations_series_idx ON observations (series, obs_date);
  CREATE UNIQUE INDEX IF NOT EXISTS observations_dedupe_idx
    ON observations (series, obs_date, value, source);

  CREATE TABLE IF NOT EXISTS machine_state (
    id         BIGSERIAL PRIMARY KEY,
    known_at   TIMESTAMPTZ NOT NULL,
    reading    JSONB NOT NULL,
    hy_oas_bp  INTEGER,
    prints     JSONB,
    tape       JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS machine_state_recent_idx ON machine_state (created_at DESC);
`

export async function ensureSchema() {
  const p = pool()
  if (!p) return
  await p.query(SCHEMA)
}

// Append observations, ignoring exact duplicates (same series/date/value/source)
// so re-running the ingest is safe. Revisions differ by value → new row.
export async function insertObservations(records) {
  const p = pool()
  if (!p || !records?.length) return 0
  let inserted = 0
  for (const r of records) {
    const res = await p.query(
      `INSERT INTO observations (series, label, unit, value, obs_date, known_at, source)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (series, obs_date, value, source) DO NOTHING`,
      [r.series, r.label ?? null, r.unit ?? null, r.value, r.obsDate, r.knownAt, r.source],
    )
    inserted += res.rowCount
  }
  return inserted
}

// Append one canonical machine-state snapshot (the reading the dashboard reads).
export async function saveState({ knownAt, reading, hyOasBp, prints, tape }) {
  const p = pool()
  if (!p) return
  await p.query(
    `INSERT INTO machine_state (known_at, reading, hy_oas_bp, prints, tape)
     VALUES ($1,$2,$3,$4,$5)`,
    [knownAt, reading, hyOasBp ?? null, prints ?? null, tape ?? null],
  )
}

export async function getLatestState() {
  const p = pool()
  if (!p) return null
  const { rows } = await p.query(
    `SELECT known_at, reading, hy_oas_bp, prints, tape
       FROM machine_state ORDER BY created_at DESC LIMIT 1`,
  )
  if (!rows.length) return null
  const r = rows[0]
  return { knownAt: r.known_at, reading: r.reading, hyOasBp: r.hy_oas_bp, prints: r.prints, tape: r.tape }
}
