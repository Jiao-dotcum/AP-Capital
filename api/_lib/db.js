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

  CREATE TABLE IF NOT EXISTS market_prices (
    id          BIGSERIAL PRIMARY KEY,
    ticker      TEXT NOT NULL,
    close       DOUBLE PRECISION NOT NULL,
    prev_close  DOUBLE PRECISION NOT NULL,
    change_pct  DOUBLE PRECISION NOT NULL,
    as_of       TIMESTAMPTZ NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE UNIQUE INDEX IF NOT EXISTS market_prices_dedupe_idx ON market_prices (ticker, as_of);
  CREATE INDEX IF NOT EXISTS market_prices_ticker_idx ON market_prices (ticker, created_at DESC);

  CREATE TABLE IF NOT EXISTS engine_runs (
    id         BIGSERIAL PRIMARY KEY,
    seq        INTEGER NOT NULL,
    known_at   TIMESTAMPTZ NOT NULL,
    reading    JSONB NOT NULL,
    hy_oas_bp  INTEGER,
    decision   JSONB NOT NULL,
    orders     JSONB NOT NULL,
    nav        DOUBLE PRECISION NOT NULL,
    world      JSONB NOT NULL,
    book       JSONB NOT NULL,
    prev_hash  TEXT,
    hash       TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE UNIQUE INDEX IF NOT EXISTS engine_runs_hash_idx ON engine_runs (hash);
  CREATE INDEX IF NOT EXISTS engine_runs_seq_idx ON engine_runs (seq DESC);
  -- Linearity: each link can be extended exactly once (COALESCE so the NULL
  -- genesis parent is unique too). Two racing ingests both chaining off the
  -- same predecessor -> the second INSERT errors instead of forking the
  -- chain; the error surfaces as engineError in that run's response.
  CREATE UNIQUE INDEX IF NOT EXISTS engine_runs_parent_idx
    ON engine_runs ((COALESCE(prev_hash, 'GENESIS')));
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

// Append one row per ticker for the day's close (point-in-time — a later
// correction lands as a new row with a new as_of, never an overwrite).
export async function insertPrices(pricesByTicker) {
  const p = pool()
  if (!p || !pricesByTicker) return 0
  let inserted = 0
  for (const [ticker, px] of Object.entries(pricesByTicker)) {
    const res = await p.query(
      `INSERT INTO market_prices (ticker, close, prev_close, change_pct, as_of)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (ticker, as_of) DO NOTHING`,
      [ticker, px.close, px.prevClose, px.change, px.asof],
    )
    inserted += res.rowCount
  }
  return inserted
}

// ————— Phase 2: the hash-chained canonical run —————
// Append-only like everything else. The unique hash index makes re-inserting
// the same sealed record a no-op, so a retried ingest can't fork the chain.
export async function insertEngineRun(run) {
  const p = pool()
  if (!p || !run) return false
  const res = await p.query(
    `INSERT INTO engine_runs (seq, known_at, reading, hy_oas_bp, decision, orders, nav, world, book, prev_hash, hash)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     ON CONFLICT (hash) DO NOTHING`,
    [run.seq, run.knownAt, run.reading, run.hyOasBp ?? null, run.decision, JSON.stringify(run.orders), run.nav, run.world, run.book, run.prevHash, run.hash],
  )
  return res.rowCount > 0
}

// The full latest run — the server's working state for chaining the next one.
export async function getLatestRun() {
  const p = pool()
  if (!p) return null
  const { rows } = await p.query(
    `SELECT seq, known_at, reading, hy_oas_bp, decision, orders, nav, world, book, prev_hash, hash
       FROM engine_runs ORDER BY seq DESC, created_at DESC LIMIT 1`,
  )
  if (!rows.length) return null
  const r = rows[0]
  return {
    seq: r.seq,
    knownAt: r.known_at,
    reading: r.reading,
    hyOasBp: r.hy_oas_bp,
    decision: r.decision,
    orders: r.orders,
    nav: r.nav,
    world: r.world,
    book: r.book,
    prevHash: r.prev_hash,
    hash: r.hash,
  }
}

// The dashboard's view of the latest run: decision + NAV + seal, without the
// carried world/book blobs.
export async function getLatestRunSummary() {
  const p = pool()
  if (!p) return null
  const { rows } = await p.query(
    `SELECT seq, known_at, decision, orders, nav, prev_hash, hash
       FROM engine_runs ORDER BY seq DESC, created_at DESC LIMIT 1`,
  )
  if (!rows.length) return null
  const r = rows[0]
  return { seq: r.seq, knownAt: r.known_at, decision: r.decision, orders: r.orders, nav: r.nav, prevHash: r.prev_hash, hash: r.hash }
}

// The latest persisted row per ticker, shaped like barsToPrices() output so
// callers (sleeveReturns, the dashboard) don't care whether a price came from
// a live fetch or the database.
export async function getLatestPrices() {
  const p = pool()
  if (!p) return null
  const { rows } = await p.query(
    `SELECT DISTINCT ON (ticker) ticker, close, prev_close, change_pct, as_of
       FROM market_prices ORDER BY ticker, as_of DESC`,
  )
  if (!rows.length) return null
  return Object.fromEntries(
    rows.map((r) => [r.ticker, { close: r.close, prevClose: r.prev_close, change: r.change_pct, asof: r.as_of }]),
  )
}
