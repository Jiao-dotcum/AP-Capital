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
- `api/ingest.js` — Vercel Cron target. Fetches FRED macro data, reuses the
  same parser as `src/live/fred.js`, and appends the observations + one
  machine-state snapshot. Also runs an independent `networkProbe` (a fetch to
  an unrelated host) so a FRED-specific failure is distinguishable from
  deployment-wide network breakage.
- `api/_lib/ingest.js` — two fetch strategies converging on one interpreter:
  `fetchFredViaCsv` (the keyless `fredgraph.csv` chart-embed backend, zero
  config) and `fetchFredViaApi` (the documented, key-authenticated
  `api.stlouisfed.org` developer API, preferred when `FRED_API_KEY` is set —
  see "If `/api/ingest` reports `fredError`" below). Both produce the same CSV
  shape and feed the same pure `fredCsvToState(csv, knownAt)` transform
  (unit-tested).

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

### If `/api/ingest` reports `fredError` (timeout or "fetch failed")

`fredgraph.csv` (FRED's keyless chart-embed backend) has been observed timing
out consistently from Vercel's serverless IPs — this survived both explicit
error-cause surfacing and forcing IPv4-first DNS resolution, which rules out a
local networking fault and points to FRED (or a WAF in front of it) silently
dropping requests from datacenter IP ranges. The fix is to switch to FRED's
actual documented, key-authenticated developer API
(`api.stlouisfed.org/fred/series/observations`), which the ingest job now
prefers automatically whenever a key is present:

1. **Get a free API key** at
   [fred.stlouisfed.org/docs/api/api_key.html](https://fred.stlouisfed.org/docs/api/api_key.html)
   (instant, no approval wait).
2. **Set one environment variable** in Vercel (Production): `FRED_API_KEY`.
3. **Redeploy.**
4. **Re-seed**, same endpoint as before:
   ```
   curl -H "Authorization: Bearer $CRON_SECRET" https://<your-app>/api/ingest
   ```
   Look for `"fredApiKeyConfigured": true` and no `fredError` key in the
   response. The response also carries a `networkProbe` field (a fetch to an
   unrelated, highly-reliable host) that tells apart "FRED specifically is
   blocked" from "outbound networking is broken for this deployment
   entirely" — if `networkProbe.ok` is false too, the problem isn't FRED.

The keyless CSV scrape remains the zero-config fallback when `FRED_API_KEY` is
unset — both paths converge on the same parser (`interpretFredCsv` in
`src/live/fred.js`), so behavior is identical either way once data arrives.

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

## Phase 2 — the canonical engine run (shipped, zero-config)

Every scheduled ingest that lands a **fresh** FRED reading now also advances
one canonical, server-side instance of the machine and appends the result to
an `engine_runs` table as a **hash-chained record**:

- The world advances through the *same* `advanceWorld()` the browser uses
  (`src/engine/world.js`) — one state transition, every path.
- One canonical paper book (the default six-sleeve election) is marked — real
  closes where Alpaca has them, factor model elsewhere — then rebalanced to
  the risk-parity target through the same planning caps and pre-trade
  compliance as the dashboard's Execution Desk.
- The record (reading, decision, this run's orders, NAV) is sealed with
  `hash = sha256(prev_hash | canonical-JSON(payload))`. Tampering with any
  stored decision breaks every hash after it; `verifyChain` in
  `api/_lib/engine.js` recomputes the whole chain from the payloads alone.
- A repeat curl with unchanged FRED data appends **nothing** (the response
  says `"engineRun": {"unchanged": true, ...}`) — the chain records
  decisions, not invocations.

Nothing to configure: it runs whenever the DB is configured and FRED returns
data. A healthy ingest response now also carries:

```json
"engineRun": { "seq": 1, "nav": 1002894.05, "dial": 31, "filled": 5, "vetoed": 0, "hash": "3f2a…", "inserted": true }
```

and `/api/state` includes the latest run summary under `"run"` (decision,
orders, NAV, hash seal) — absent until the first chained run lands.

### Credit fundamentals (SEC EDGAR) — one env var, no key

EDGAR's `data.sec.gov` API is free and keyless; what SEC requires is a
descriptive `User-Agent` identifying the caller. Set one variable in Vercel:

- `SEC_USER_AGENT` — e.g. `AP Capital your-email@example.com`

Redeploy, re-seed, and look for `"secConfigured": true` and a non-zero
`"issuersParsed"` / `"fundamentalsStored"`. The dashboard's EDGAR panel then
loads live coverage/leverage from the scheduled feed on every visit — no
Anthropic key, no button click (both still work as manual overrides).
Unset, the feed is skipped and the panel keeps its offline estimates.

### The real trading desk — needs BOTH SEC_USER_AGENT and Alpaca

With `SEC_USER_AGENT` AND `ALPACA_KEY_ID`/`ALPACA_SECRET_KEY` all set,
`api/_lib/realIssuers.js` KMV-unlevers the EDGAR fundamentals above against
a live Alpaca equity price history and, for any name that clears every gate,
adds it to the desk's ACTUAL traded universe (`tradedIssuers`, not just the
benchmark panel) — see `docs/ENGINE_GUIDE.md` §6 for the methodology. Either
var alone is not enough: EDGAR without Alpaca has fundamentals but no equity
value/vol to unlever; Alpaca without EDGAR has prices but no debt/EBITDA.
Look for `"realIssuersTraded"` (the names that made it in) and
`"realIssuerErrors"` (names that didn't, and why) in the ingest response.

### The external anchor — turning tamper-evident into tamper-proof

The hash chain proves the record is internally consistent. It cannot prove
the record is *old*, because we own the database — a skeptic can always say
the whole history was regenerated last night. Anchoring fixes that by
committing the chain's head hash to a repository we don't control, where
GitHub timestamps the commit server-side. A commit cannot be backdated on
someone else's server.

1. **Create a public repo** for the anchors (e.g. `ap-capital-anchors`).
   Public matters — the point is that anyone can check it. It holds only
   hashes, no positions or P&L.
2. **Create a fine-grained personal access token** (GitHub → Settings →
   Developer settings → Personal access tokens → Fine-grained). Scope it to
   *only* that one repo, with **Contents: Read and write**. Nothing else.
3. **Set two env vars** in Vercel (Production):
   - `GITHUB_TOKEN` — the token
   - `ANCHOR_REPO` — `youruser/ap-capital-anchors`
   - (optional) `ANCHOR_PATH` — defaults to `anchors/chain.jsonl`
4. **Redeploy**, then run the ingest. Look for
   `"anchor": { "anchored": true, "commit": "...", "url": "..." }`.
   An unchanged chain head anchors nothing (`"anchored": false,
   "reason": "head unchanged since last anchor"`) — the log records distinct
   chain states, not invocations.

**How someone verifies you without trusting you:**

```
GET /api/chain          → recomputes every link, reports head + where the anchor lives
open the anchor repo    → find the entry dated before today
compare the head hashes
```

Step one proves internal consistency; step two proves age. A rewritten
history cannot reproduce a head hash already committed to GitHub last month.
`/api/chain` deliberately reports *where* the anchor is rather than claiming
it agrees — a self-reported "verified: true" would prove nothing.

The anchor runs in its own try/catch after the engine step: a publishing
failure never fails the run that produced the data, and surfaces as
`anchorError`.

### The Alpaca paper broker — next-open execution on a real venue

The paper book decides and fills at the *same* close (see
`docs/RISK_POLICY.md` §5). No real account can do that: once the closing
print exists, the chance to trade at it is gone. This slice submits the same
run's Core target weights to an **Alpaca paper account** as market-on-open
orders, so they fill at the next session's opening auction — a price nobody
knows at decision time.

It will not reproduce the paper book's numbers, and is not meant to. **The
gap between the two is the measurement**: what the same-close shortcut is
worth in dollars on a real venue, the same way the control arm measures the
ruin ceiling instead of assuming it.

1. **Get paper-trading keys** at alpaca.markets → Paper Trading → API Keys.
   These are *different* keys from the market-data pair already configured.
2. **Fund the paper account to $1,000,000** (Alpaca → Paper Trading → Reset
   Account, set the starting balance). This matters: the paper books carry
   $1M NAV, and the comparison is only readable in dollars when both sides
   are the same size. Each broker record seals a `scaleRatio` (account equity
   ÷ benchmark NAV) — outside roughly 0.9–1.1, read percentages instead.
3. **Set two env vars** in Vercel (Production):
   - `ALPACA_PAPER_KEY_ID`
   - `ALPACA_PAPER_SECRET_KEY`
   Deliberately separate names: having market data working must never imply
   order submission is on.
4. **Redeploy**, then run the ingest. Look for
   `"broker": { "recorded": true, "equity": ..., "submitted": N,
   "fillTiming": "next-open (market-on-open)",
   "mirrors": "control-arm (ruin ceiling off)", "scaleRatio": ~1.0 }`.

**Which book it mirrors: the CONTROL ARM.** Both Core books target the same
weights (`decision.coreTargetWeights`) and differ only in whether compliance
halts buys under the 2.5% ruin ceiling. The broker never applies that gate,
so it is a control-arm mirror. That is the correct pairing, not a workaround:
comparing it to the canonical book would confound two differences at once —
fill timing *and* the ceiling — and the residual would attribute neither.
Against the control arm exactly one thing differs, which is the whole point.
It is also the only pairing that produces data while the ceiling is breached,
since a mirror of the halted book would submit nothing.

**The 50bp cash buffer.** Orders are sized off last night's close but fill at
the next open. An order sized at 100% of equity exceeds buying power whenever
the market gaps up, and the venue rejects it — systematic rejection on every
gap-up day is a broken desk, not information. The broker therefore sizes to
99.5% of equity. It costs a little tracking error against the paper book
(small next to the gap effect being measured) and is sealed as
`cashBufferPct` in every record so the analysis accounts for it rather than
discovering it. Over-gross targets are refused outright rather than sized
into margin.

**Safety, by construction:**

- The host is **hard-coded** to `paper-api.alpaca.markets`. Live keys against
  it simply fail to authenticate, so no configuration mistake can route this
  at real money. `scripts/verify.mjs` asserts every Alpaca host in the file
  is the paper one.
- Orders carry a deterministic `client_order_id` (`apcap-<seq>-<TICKER>`).
  Alpaca rejects duplicates, so a re-run of the same seq cannot
  double-submit — the venue itself enforces idempotency.
- Sizing is **whole shares off the real account equity**; the rounding
  residual stays in cash. No fractional or notional orders (market-on-open
  doesn't take them).
- It runs only on a **freshly inserted** run — a quiet day produced no new
  decision, so there is nothing new to mirror.
- Its own try/catch: a venue outage surfaces as `brokerError` and never
  fails the run that produced the data. It never feeds back into a decision.

**Why it is not in the hash chain.** `runEngineStep` computes the hash before
any network call, and `verifyChain` recomputes it from stored fields alone. A
live venue's account equity and fill prices are neither pure nor knowable at
hash time, so sealing them into the payload would make the chain
unverifiable. Broker records live in their own append-only `broker_runs`
table and **cite** the run hash they mirror. The link is auditable; the chain
stays provable.

**Reading fills.** An order queued after the close cannot fill until the next
open, so `submitted` on run N is confirmed by `recentFills` on run N+1.
That lag is real, not a defect.

**Open decision — chaining `broker_runs` (revisit after ~30 days of fills).**
Broker rows are append-only but NOT hash-chained, so unlike the engine
journal they are tamper-evident only by database convention. That is
acceptable while this is a measurement nobody is being shown. It stops being
acceptable the moment the broker book is presented as a track record: at that
point it needs its own chain (it cannot join the engine chain — see "Why it
is not in the hash chain" above). Deferred deliberately until there are
enough fills to know whether the number is worth publishing at all.

### The dial override (human ratification, canonical)

The Charter's human override now binds the canonical run, not just one
browser tab. Owner-only (CRON_SECRET bearer):

```
# pin the dial at 62 (0–100)
curl -X POST -H "Authorization: Bearer $CRON_SECRET" -H "content-type: application/json" \
  -d '{"dial": 62, "note": "why"}' https://<your-app>/api/override

# resume automatic
curl -X POST -H "Authorization: Bearer $CRON_SECRET" -H "content-type: application/json" \
  -d '{"dial": null}' https://<your-app>/api/override
```

Overrides are append-only rows; each canonical run records the override it
obeyed inside its hash-sealed decision (`decision.dialOverride`), and a
changed override counts as a new decision even when macro data hasn't moved.

### The daily journal (Phase 2b — shipped, zero-config)

Each trading day's run now seals three more things into its chained record:

- **P&L, attributed**: `pnl` — NAV start→end, day P&L split from trading
  cost (slippage) and cash yield, and per-asset rows (dollars allocated,
  weight, cap headroom, the day's mark move and P&L on the position held
  into the day). Booked close-over-prior-close; open→close is carried in
  the price rows for the session tape.
- **Every trade's reason**: each order carries a deterministic `rationale`
  (strategy, dial + posture + automatic/human-ratified, regime, current→
  target weight, unified grade, binding caps) written at planning time.
- **The risk statement**: `risk` — annualized vol, CVaR 95/99 (% and $),
  four-season risk shares, gross vs. ceiling, drawdown vs. the de-risk
  schedule, and the named crisis replays run on that day's weights.

The cron moved to **21:30 UTC weekdays** (after US close) so a run books the
trading day it closes. `GET /api/journal?limit=30` returns the entries
newest-first; the dashboard's Execution Desk renders them automatically once
runs exist. The standing rules live in `docs/RISK_POLICY.md`.

### Auditing and anchoring the chain

`GET /api/chain` recomputes every hash link server-side and reports
`{ length, head, verified }`; add `?full=1` for every sealed payload. The
chain is tamper-evident on its own; to make it tamper-proof, **anchor the
head**: snapshot the response somewhere the database writer can't touch —
curl it weekly into a local file, email it to yourself, or commit it to git.
A rewritten history cannot reproduce an anchored head hash.

## Notes / next steps

- Every table is append-only; revisions land as new rows, so the macro
  register, the price history, and the run chain all stay lookahead-proof.
  Nothing is ever overwritten.
- Alpaca's IEX feed is free and sufficient for daily-close marks. If the book
  ever needs intraday or SIP-consolidated prices, that's a paid Alpaca tier —
  same integration, just a plan upgrade, not a code change.
- TLS currently uses `rejectUnauthorized: false` for provider convenience —
  harden to a pinned CA before real capital.
- **Alpaca is deliberately the market-data vendor** because it's also a
  broker: Phase 4 (real execution) reuses this same integration for order
  routing, so market data and execution consolidate behind one account instead
  of two.
- The dashboard still computes its own view locally; making it a pure view
  onto the server's canonical run (and surfacing the chain in the UI) is the
  natural next slice, now that the chain exists.
