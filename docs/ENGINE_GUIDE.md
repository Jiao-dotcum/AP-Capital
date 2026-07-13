# The Engine, From Zero — a prerequisite guidebook

This is the companion to the visual primer (the "Complete Machine" artifact):
that one teaches the *investment ideas*; this one teaches **the code** — what
each module does, in what order to read them, and how to check anything with
your own hands. Written for the owner: a finance student who should be able
to open any file in `src/engine/` and know what he's looking at.

## 0 · The ten concepts everything rests on

Learn these first; every module assumes them.

1. **Surprise, not news.** Prices contain expectations, so only the gap
   between the print and the expectation moves anything. The machine's whole
   input is two numbers: growth surprise `g` and inflation surprise `i`.
2. **Sigma (σ).** The unit of surprise: how many "typical-sized misses" a
   print landed from consensus. `g = +1.0` = one typical beat.
3. **Percentile.** "Where does today rank against everything seen before?"
   Turns raw readings (420bp — high? low?) into comparable 0–100 scores.
4. **Volatility.** The standard deviation of returns, annualized — the
   loudness of an asset. A dollar of a loud asset carries more risk than a
   dollar of a quiet one; that asymmetry is why risk parity exists.
5. **Covariance / correlation.** How assets move together. A book of things
   that fall together is one bet wearing many costumes.
6. **Sharpe ratio.** Return earned above cash per unit of volatility — "was
   the risk paid for?" Below ~0.2, basically no.
7. **Drawdown.** Peak-to-trough loss. The number that decides whether an
   investor stays in.
8. **Risk parity.** Size positions so each contributes equal RISK, not equal
   dollars — quiet assets get more capital.
9. **Margin of safety.** Buy at enough of a discount that being wrong still
   doesn't lose badly. Oaktree's entire risk control.
10. **Hash chain.** Each record is fingerprinted together with the previous
    record's fingerprint, so rewriting any historical entry breaks every
    fingerprint after it. Tamper-*evident* storage; anchoring the newest
    hash somewhere external makes it tamper-*proof*.

## 1 · The world in one loop

Everything simulated flows from one loop (`src/engine/macroPath.js`):

```
each month:  reading (g, i)  →  credit cycle evolves from it  →
             every asset's return = drift + betas·surprises + shared shock + noise
```

Three things to internalize:
- **One seed ⇒ one world.** All randomness comes from seeded generators
  (`prng.js`); the same seed replays the identical 22 years forever. That's
  what makes every claim checkable.
- **The credit cycle is DOWNSTREAM of the macro reading** (`stress = −g +
  0.35i`). This is why the dial was never independent information about the
  beta book — the insight behind the two-mandate wall.
- **Returns are factor-built**: each asset has `bG`/`bI` (growth/inflation
  sensitivity) and `bM` (shared-shock beta, amplified in stress). Nothing is
  a price series pulled from anywhere; it's all generated, honestly labeled.

## 2 · Reading order for `src/engine/`

Read top to bottom; each file leans only on the ones above it.

| # | File | One sentence |
|---|------|--------------|
| 1 | `prng.js` | Seeded randomness: `mulberry32`, `normal`, `clamp`. Ten lines; read it fully. |
| 2 | `machine.js` | Readings, the four regimes, risk-of-ruin. The Bridgewater worldview in 90 lines. |
| 3 | `assets.js` | The 17-asset universe and the canonical return generator. |
| 4 | `cycle.js` | The Oaktree layer: seven gauges → percentiles → the dial; the two mandates' capital split (`MANDATE_SPLIT`, `creditWeightsFor`, `houseView`). |
| 5 | `risk.js` | Ledoit–Wolf covariance, four-season risk parity at fixed 1.0× gross, CVaR, crisis replays. |
| 6 | `pureAlpha.js` | The six principles as a vol-targeted long/short overlay; `coreTargets` = rp + tilt, long-only, gross ≤ 1. |
| 7 | `credit.js` | Ten issuers: Merton distance-to-default → PD → fair spread → divergence → margin-of-safety weights. |
| 8 | `world.js` | THE state transition (`advanceWorld`) — every path, browser or server, steps the world through this one function. |
| 9 | `oms.js` | The paper broker: caps clipped at planning, pre-trade veto as backstop, slipped fills, blotter. |
| 10 | `grades.js` | One conviction score, everywhere — so a holding can't be an A in one panel and a C in another. |
| 11 | `macroPath.js` | The shared seeded walk consumed by the standalone backtests. |
| 12 | `backtest.js` | The legacy 22y walk-forward — kept verbatim as the court record that justified the decoupling. |
| 13 | `mandateBacktest.js` | Each mandate's own track: Core = rp + PA blend (the live formula); Credit = the full-rigor walk. |
| 14 | `creditBacktest.js` | Issuer histories that evolve, migrate, and default; the ledger that realizes losses; the discrimination test. |
| 15 | `firm.js` | The 8-layer agent hierarchy, believability scores, the quarterly memo. |
| 16 | `pit.js` | The append-only point-in-time register (`obsDate` vs `knownAt`). |
| 17 | `rules.js` / `origination.js` / `sourcing.js` / `montecarlo.js` | The principles' definitions, the docket, the catalyst scan, the GBM fan. |

Then the server (`api/`): `_lib/engine.js` (the canonical run: advances the
same `advanceWorld`, trades both paper books, seals everything into the hash
chain), `_lib/creditBook.js` (the credit mandate's live ledger),
`_lib/db.js` (append-only Postgres), `ingest.js` (the daily cron),
`state.js`/`journal.js`/`chain.js`/`override.js` (the read/governance
endpoints).

## 3 · A day in the life (what actually happens at 21:30 UTC)

1. Vercel Cron fires `/api/ingest`.
2. FRED returns the day's real prints → `interpretFredCsv` turns them into a
   surprise reading `{g, i}` plus the HY OAS spread. Alpaca (if configured)
   returns real closes; EDGAR (if configured) refreshes issuer fundamentals.
3. `runEngineStep`: the world advances through `advanceWorld` (cycle from
   the REAL spread, dial settled through its deadband, honoring any fresh
   human override — overrides expire after 30 days).
4. The **Core book** marks to real closes where available, then rebalances
   to `coreTargets(riskParity, pureAlphaTilt)` through caps and compliance.
   Every order gets a written rationale at planning time.
5. The **Credit book** re-screens the issuers on the day's cycle, accrues
   carry, marks prices, pays turnover costs, deploys powder only if ≥ 2
   distress triggers arm — its trades carry second-level-thinking reasons.
6. Both books' P&L, the risk statement (CVaR, seasons, drawdown rung), and
   every trade with its reason are sealed:
   `hash = sha256(prevHash | canonical-JSON(payload))` → appended to
   `engine_runs`. A repeat run with unchanged data appends nothing.
7. The dashboard reads `/api/state` and `/api/journal` on load — no keys, no
   clicks. `/api/chain` re-verifies every link on demand.

## 4 · How to check anything yourself

The project's culture is: **never trust a claim you didn't recompute.**

- `node scripts/verify.mjs` — the full pipeline (engine determinism, book
  sanity, both mandates' backtests, build, headless-browser render).
- The scratchpad pattern for anything new: write a throwaway `.mjs` that
  imports the module by absolute path, asserts behavior against a fixture,
  and runs it twice to confirm determinism. Engine modules must run in bare
  Node — if one can't, it's broken by definition (Invariant 1).
- The named failure modes in `CLAUDE.md` are the accumulated scar tissue —
  each one actually happened. Read them before touching the area they name.

## 5 · Load-bearing numbers to memorize

| Number | Meaning |
|---|---|
| 45 / 55 | Fixed firm capital split, Core / Credit — the wall |
| 1.0× | Core's gross, constant; the dial has no authority there |
| 4% / 0.5 | Pure Alpha overlay: vol budget / gross cap |
| ±5 | Dial deadband — wobbles smaller than this are ignored |
| ≥ 2 of 3 | Distress triggers required before powder deploys |
| 2.5% | Risk-of-ruin ceiling — above it, buys halt, sells clear |
| 25% / 45% / 1.6× | Single-name / class / gross caps in the OMS |
| 30 days | A dial override's lifetime before it must be re-ratified |
| 13 | Dashboard sections; verify asserts it |
