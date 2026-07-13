# CLAUDE.md — Operating Manual for The Complete Machine

This file is the operating manual, not just a map. It encodes the conventions,
the named failure modes (each one actually happened), and the checkable
quality bars. Follow it exactly; when you change the architecture, update this
file in the same commit.

## What this is

A single-page React app (Vite, Vercel) simulating a Bridgewater × Oaktree
autonomous fund run as **two decoupled mandates** — AP Cycle Credit (the
Oaktree engine: credit-cycle dial, credit screens, dry powder; sections I–III)
and AP All Weather Core (the Bridgewater engine: macro regime reading,
risk-parity book at fixed 1.0× gross; sections IV–IX) — over shared firm
infrastructure (allocation governance, paper-trading OMS, 8-layer agent firm,
walk-forward backtest; sections X–XIII), plus a growing serverless backend
(`api/`) that feeds it live FRED and market data. The owner intends to raise real capital and route it through this
machine eventually; today everything is **simulated or paper**, and the code
enforces that boundary (see The Charter, bottom). Treat every change as if a
regulator and an investor will both read it later, because they might.

## Commands

- `npm install` — install dependencies
- `npm run dev` — Vite dev server at http://localhost:5173
- `npm run build` — production build to `dist/`
- `npm run preview` — serve the production build

No test framework or linter is configured. Verification is the pipeline below
— run it after every non-trivial change; `/verify` (project skill) automates it.

## The verification pipeline (mandatory before commit)

1. **Engine checks** (pure logic): write a throwaway `.mjs` in the scratchpad
   that imports the module from an absolute path and asserts behavior against
   fixtures. Engine modules run in bare Node — if an import fails outside the
   browser, the module is broken (see Invariant 1).
2. **Build**: `npm run build` must exit 0. **A green build does not mean the
   page renders** (see failure mode "the bundle-order crash").
3. **Headless browser**: serve `dist/` and load it in Chromium at
   `/opt/pw-browsers/chromium` via `playwright-core` (already in
   node_modules of the scratchpad; never `playwright install`). Assert:
   section count, zero console errors (excluding `ERR_TUNNEL`/
   `Failed to load resource` — those are the Wikimedia art plates, blocked in
   sandboxes and designed to withdraw gracefully), and presence of key text
   markers **case-insensitively**.
4. **Push**: commit with a message that says what changed and *why the design
   is what it is*, then push to the working branch **and** `main`
   (`git push origin <branch>:main`) — Vercel deploys `main`.

Current expected section count: **13** (I–XIII). Update this number here and
in the verify skill when you add or remove a section.

## Architecture

Browser state lives in `src/App.jsx`: a trail of `{g, i}` macro-surprise
readings (σ units), a coupled credit-cycle object, the settled dial, the
decision feed, the paper book, and the point-in-time register.
**`advanceWorld()` (in `src/engine/world.js`) is the single state
transition** — the simulate path, the manual live path, the backend auto-load
path, AND the server's canonical engine run all import and call this one
function. Never advance the world any other way.

- `src/engine/` — pure logic, no React, deterministic per reading:
  - `prng.js` — mulberry32, Box–Muller `normal`, `clamp`. All randomness
    everywhere flows from seeded mulberry32.
  - `world.js` — `seedWorld()` + `advanceWorld(rng, world, reading,
    liveSpread)`: THE per-release state transition (Invariant 2), plus the
    shared constants (`SEED`, trail/feed lengths, `DEFAULT_ELECTED`). Shared
    verbatim by `App.jsx` and `api/_lib/engine.js`.
  - `machine.js` — surprise draws, `PRICED_IN` consensus constants, release
    tape, regime quadrants, three gears, risk-of-ruin (ceiling 2.5%).
  - `cycle.js` — credit-cycle evolution coupled to macro stress; seven proxies
    scored as **percentiles** in a rolling history (a seeded ten-year
    climatology + the session's cycle states); the Aggressiveness Dial settled
    through a ±5-point deadband (`settleDial`); dry-powder triggers (≥2 armed
    authorizes). **The two mandates** (the decoupling): `MANDATE_SPLIT` fixes
    firm capital at Core 45 / Credit 55; `creditWeightsFor(dial)` is the
    Cycle Credit mandate's internal [performing, distressed, powder] split
    (the dial's ONLY jurisdiction); `houseView(dial)` is the firm five-sleeve
    view with Core fixed. The legacy `weightsFor` anchors remain verbatim —
    the backtest walks them as the coupled policy the firm measured and
    rejected.
  - `credit.js` — 10 issuers from structural fundamentals; Merton
    distance-to-default from EV-multiple/leverage/asset-vol; PD via an
    **empirically calibrated DtD→PD map** (`pdFromDtD` — the Gaussian tail is
    deliberately not used); expected-loss model-fair spread vs rating-anchored
    market spread → divergence (second-level thinking); ratings-transition
    matrix; MoS sizing with name/sector caps applied at the gate.
    Deterministic per cycle print via `hash01`, not rng.
  - `assets.js` — 17-asset UNIVERSE with `er/vol/bG/bI/bM/carry`;
    `monthlyReturn` is the **canonical return generator** (drift + macro
    betas·SURPRISE_PP + shared market shock·MARKET_VOL·bM, stress-amplified
    via `stressAmp` + idiosyncratic residual); `rankIntoTiers` distributes any
    universe size across five tiers.
  - `grades.js` — the **unified grade**: one composite conviction
    (macro: regime/posture/carry/premium; credit: divergence+MoS) → letter
    A+…F. Register, Origination docket, and Execution book all import THIS.
  - `risk.js` — Ledoit–Wolf shrunk covariance from the same 22-year history
    the backtest walks (identical rng draw order — see Invariant 3); risk-on
    crisis-vs-calm correlation; four-season risk parity by **standalone-vol
    equalization** (not ERC — see failure mode) at **fixed `CORE_GROSS` =
    1.0×** — the dial no longer scales this book's gross (see "one factor,
    counted twice"); CVaR 95/99; drawdown de-risking schedule;
    block-bootstrap MC with named crisis replays.
  - `pureAlpha.js` — the six principles as a REAL overlay: legs per
    principle, each fired bet risk-balanced by its spread vol (same L–W
    covariance as the risk desk), combined tilt scaled to `PA_VOL_TARGET`
    (4% ann.) and gross-capped (0.5); `coreTargets(rp, tilt)` = the Core
    book's actual target (long-only clamp, gross ≤ 1 — shorts only reduce
    existing longs, no borrowing). Wired ONLY after clearing a
    pre-registered 30-seed gate (standalone Sharpe 0.163; blend beat
    rp-only 23/30, avg 0.313 → 0.358, +0.41pp maxDD). Re-tuning any
    constant requires re-running that gate.
  - `macroPath.js` — the one seeded macro walk (reading → cycle → returns,
    fixed draw order) consumed by mandateBacktest and the PA gate;
    `backtest.js` keeps its own verbatim copy as the frozen court record.
  - `backtest.js` — 22y walk-forward, rules frozen at T, graded at T+1;
    per-principle/regime/dial hit rates; turnover with/without deadband;
    exposes the monthly return `series` and `windowStats(series, years)` for
    the lookback slider.
  - `mandateBacktest.js` — standalone return tracks for each mandate over
    the shared `macroPath` walk: Core = the live formula (`coreTargets` of
    risk parity + the PA tilt, lagged one period), Credit from the
    full-rigor walk below blended by `creditWeightsFor(dial)` lagged one
    period, distressed sleeve on the CLO BB proxy gated by the same deploy
    triggers.
  - `creditBacktest.js` — the full-rigor credit walk
    (`docs/CREDIT_BACKTEST_SCOPE.md`): issuer fundamentals evolve monthly on
    their own per-issuer mulberry32 streams (Invariant 3), ratings actually
    migrate and default through the monthly-ized `TRANSITION` matrix
    (default intensity modulated by cycle stress AND current
    distance-to-default, so the screen's gates face an adversarial test),
    and a position ledger realizes carry, price MTM, default losses, and
    25bp one-way turnover costs. Verify enforces defaults > 0 (a NaN DtD
    once silently zeroed the default column) and the discrimination floor:
    rejected names must default more often than held names. Synthetic paths
    calibrated but NOT yet validated against historical data — scope §4.
  - `oms.js` — paper OMS: $1M notional, 4bp slippage, targets clipped to
    caps at planning, `preTrade` compliance veto as backstop, ruin-breach
    halts buys (sells always clear), NAV/blotter persisted to localStorage.
  - `proxies.js` — sleeve→ETF ticker map + `sleeveReturns(pricesByTicker)`:
    the seam between real closes and the book's marks.
  - `pit.js` — append-only point-in-time register (`obsDate` + `knownAt`);
    revisions append, never overwrite; `pitLatest(store, series, asOf)` is
    lookahead-proof by construction.
  - `firm.js` — 8 layers each owning an artifact + check + believability
    score from the backtest; believability-weighted IC votes; quarterly memo
    quoting base rates and standings.
  - `origination.js` / `sourcing.js` — conviction-ranked docket; catalyst
    scanner + forced-seller detector + the hard second-level gate (consensus /
    why-wrong / kill-condition or HELD).
  - `montecarlo.js` — GBM fan; accepts override moments from `risk.js`.
  - `rules.js` — six IF/THEN Pure Alpha principles.
- `src/live/` — browser-side live paths, all degrade silently to simulation:
  `fred.js` (web_fetch → fredgraph.csv, parsed deterministically client-side),
  `fetchLive.js` (web-search fallback), `edgar.js` (SEC XBRL → same Merton
  pipeline), `convene.js` (live IC debate + memo), `backend.js` (reads
  `/api/state`; `null` on any failure).
- `api/` — Vercel serverless + cron (see `docs/BACKEND.md` for go-live):
  `ingest.js` (daily cron: FRED + Alpaca IEX bars, **independent try/catch
  per source**, plus the canonical engine step), `state.js` (read endpoint,
  includes the latest run summary), `_lib/db.js` (Postgres via
  `DATABASE_URL`, append-only tables incl. `engine_runs`, every function
  no-ops unconfigured), `_lib/ingest.js` + `_lib/marketdata.js` (pure
  transforms + thin fetch wrappers; FRED prefers the key-authenticated
  developer API when `FRED_API_KEY` is set, falls back to the keyless CSV),
  `_lib/engine.js` (**Phase 2 — the canonical run**: advances ONE server-side
  world through the same `advanceWorld`, rebalances ONE canonical paper book,
  seals each record with `hash = sha256(prevHash | canonical-JSON(payload))`;
  `verifyChain` recomputes every link; a repeat ingest with unchanged FRED
  data appends nothing — the chain records decisions, not curls),
  `_lib/edgar.js` (SEC XBRL fundamentals server-side, gated on
  `SEC_USER_AGENT` — SEC wants an identifying UA, not a key; reuses the
  client's `deriveFundamentals` verbatim), `override.js` (the Charter's human
  dial ratification, owner-only, append-only, recorded inside each run's
  sealed decision), `chain.js` (recomputes the whole hash chain;
  anchor its head externally to make tamper-evident into tamper-proof),
  `journal.js` (the daily journal read endpoint), `_lib/creditBook.js` (the
  Cycle Credit mandate's own $1M live paper ledger: performing sleeve marks
  off the real screen, distressed off the CLO proxy gated by triggers,
  orders with second-level reasons; state persisted per run in
  `credit_book`, P&L/orders sealed as the `credit` block). Each run seals
  `pnl` (Core day P&L attributed per asset, slippage split out), `risk`
  (CVaR, season shares, drawdown rung, crisis replays), and `credit`, and
  gives every order a deterministic `rationale` written at planning time —
  the standing rules live in `docs/RISK_POLICY.md`; cron fires 21:30 UTC
  weekdays (post-close). Dial overrides expire after 30 days
  (`OVERRIDE_TTL_DAYS` in ingest); `/api/state` carries a `stale` flag when
  the latest run is > 4 days old. `docs/ENGINE_GUIDE.md` is the from-zero
  reading guide for all of this.
- `src/components/` — one component per section + `chrome.jsx` +
  `Tearsheet.jsx` (print-only investor page; disclaimer language is
  load-bearing — never weaken it).
- `src/styles/tokens.css` — ALL colors and fonts as CSS variables;
  `app.css` — structure + the Gothic-diaper body background (a literal-hex
  SVG data URI; see failure modes).

## Invariants (violating any of these is a bug, even if nothing crashes)

1. **Engine purity.** `src/engine/*` imports nothing from React and touches
   no `window`/`document`/`localStorage`/`fetch`. Persistence and I/O live in
   `App.jsx`, `src/live/`, or `api/`. Check: the module must import and run in
   bare Node.
2. **One state transition.** Every new reading — simulated, manual-live, or
   backend — flows through `advanceWorld()`. If you need new per-release
   state, add it to the world object inside `advanceWorld`, seeded in
   `seedWorld`.
3. **Determinism and draw order.** Same seed ⇒ same world, always. `risk.js`
   reproduces `backtest.js`'s history by making the *identical sequence of rng
   calls* — never insert, remove, or reorder rng draws inside an existing
   loop. New randomness gets its own `mulberry32(seed)`. Changing UNIVERSE
   size legitimately shifts every seeded result downstream; that's acceptable
   but must be called out in the commit message.
4. **One formula, one module.** A number shown in two places must be computed
   in one (`grades.js` exists because conviction was once computed twice).
   Never re-implement scoring math at a call site — import it.
5. **Graceful degradation.** Every live/backend feature no-ops cleanly when
   unconfigured: API routes return `{configured:false}`, clients return
   `null` and fall back silently, `localStorage` access is wrapped in
   try/catch. The app must behave identically with zero env vars set.
6. **Append-only truth.** `observations`, `market_prices`, the PIT register,
   the blotter: corrections and revisions are new rows/records with their own
   timestamps. Nothing historical is ever overwritten.
7. **Server deps stay server-side.** `pg` (and future server-only packages)
   are imported only under `api/`. If the client bundle size jumps after a
   backend change, you've leaked one.
8. **The Charter.** Paper/own-capital only; listed proxies only; no real
   broker keys in code; the dial override (human ratification) stays; every
   simulated/paper figure is labeled as such. Disclaimer strings in
   `Tearsheet.jsx`, the Execution section note, and the footer are
   load-bearing legal language — never weaken, never remove.

## Named failure modes and the rule that prevents each

Every one of these happened in this repo. A weaker model will do them again
unless it follows the rule.

- **The bundle-order crash.** A `useMemo` (`baseRates`) was declared *after*
  the memo that referenced it; `npm run build` passed and the deployed page
  died with `Cannot access 'A' before initialization`. → *Rule: in `App.jsx`,
  declare every derived value above its first reference, and never call the
  build done until the headless-browser check has rendered the page.*
- **The uppercase probe.** A browser assertion on `innerText` failed because
  `.lbl` applies `text-transform: uppercase` and Chromium's `innerText`
  reflects it. → *Rule: all text assertions against the rendered page are
  case-insensitive (`/marker/i` or `.toLowerCase()`).*
- **The invisible motif.** The body-background SVG data URI failed three ways:
  CSS variables don't resolve inside data URIs (write literal hexes), `#` must
  be `%23`, and unencoded spaces break unquoted `url()` (always double-quote).
  → *Rule: data-URI SVG uses literal palette hexes, URL-encoding, and quoted
  `url("...")`; verify by screenshot, not by build.*
- **The dead credit desk.** Re-anchoring market spreads to the expected-loss
  model made every issuer REJECT and the book empty — mathematically fine,
  economically nonsense. → *Rule: after touching any screen, gate, or cap,
  print the full screen table at `CYCLE0` and require a non-empty book
  (weights sum ≈ 100, verdict mix includes PRIME/HOLD) before proceeding.*
- **The vetoed Treasury sleeve.** Pre-trade compliance dropped an over-cap
  order entirely, leaving the book with zero rates exposure. Real compliance
  resizes. → *Rule: caps clip targets at planning time
  (`targetPositions`); `preTrade` is the backstop for genuine breaches. A
  routine rebalance must produce zero vetoes.* **It recurred** the moment a
  rebalance followed marks moving off par: a target clipped to the *exact*
  cap trips `preTrade` anyway, because order qty rounds up to 2dp and NAV
  drifts below its planning value as earlier fills pay slippage (worst case
  `SLIPPAGE_BP × grossCeiling` ≈ 6.4bp of NAV). → *Rule: planning clips
  `CAP_HEADROOM` (10bp of NAV) under every cap, and the zero-veto check must
  run on a book whose marks have moved (see `runEngineStep` in verify), not
  only on a fresh all-par book — round numbers hide the boundary.*
- **The collapsed risk parity.** True equal-risk-contribution iteration
  collapsed to a single season because hedge assets have negative marginal
  risk contribution. → *Rule: season sizing is standalone-vol equalization;
  do not "fix" it back to ERC. Check: the four season risk shares read
  25/25/25/25.*
- **The washed-out correlation.** Average pairwise ρ over the whole universe
  is ~0 *by design* (hedges offset risk-on assets), which made the
  crisis-correlation story invisible. → *Rule: cross-asset correlation claims
  are measured within the `RISK_ON` cohort, and the crisis mechanism lives in
  `stressAmp` (the shared shock amplifies in risk-off months).*
- **"fetch failed" says nothing.** Node/undici buries the real network error
  in `err.cause` and reports the useless string "fetch failed". → *Rule:
  every server-side fetch wrapper catches, surfaces `err.cause.code`, and
  sets an explicit `AbortSignal.timeout`; multi-source handlers use
  independent try/catch per source so one failure doesn't mask another.*
- **The sandbox 403.** This dev environment's egress policy blocks
  `fred.stlouisfed.org`, `data.alpaca.markets`, Wikimedia, and even the
  deployed Vercel app (403 CONNECT). → *Rule: never diagnose code from a
  sandbox network failure. Verify transforms against fixtures; verify request
  shape by intercepting `global.fetch`; the live round-trip is confirmed only
  by the owner's seed curl against the deployed app.*
- **FRED units.** `BAMLH0A0HYM2` (HY OAS) is quoted in **percent** — convert
  ×100 to bp. CPI YoY needs the observation ~365 days before the latest, not
  a fixed row offset. → *Rule: every new data series gets its units written
  down at the parse site and a plausibility clamp (`plausible(v, lo, hi)`).*
- **The pasted secret.** A live database connection string was once pasted
  into chat. → *Rule: secrets go directly into the Vercel env UI, never into
  chat, code, or commits. If one is exposed, rotate it immediately. Neon
  connection strings must be the pooled (`-pooler`) variant for serverless.*
- **The array that wasn't JSON.** The machine's first live ingest stored 7
  observations and sealed engine run #1, then died on `saveState` with
  Postgres "invalid input syntax for type json": node-pg serializes a
  TOP-LEVEL JS array as a Postgres array literal (`{...}`), not JSON, so the
  JSONB `tape` column rejected it — while plain objects (`reading`,
  `prints`) JSON-stringify correctly and sailed through. → *Rule: any
  top-level array bound to a JSONB parameter is `JSON.stringify`'d
  explicitly at the call site. The db-jsonb fixture test stubs `pg.Pool` and
  asserts no write path passes a bare array — run it when touching db.js.*
- **One factor, counted twice.** The Aggressiveness Dial (credit-cycle
  despair) originally scaled the WHOLE book's gross 0.5×–1.5× and slid
  capital between all five sleeves. But the credit cycle is computed FROM the
  macro surprise (`stress = −g + 0.35i`), so the dial is a lagged echo of the
  same factor the beta book already carries — the coupling levered the book
  up during its own drawdowns. The walk-forward priced it: worse CAGR, vol,
  maxDD, and Sharpe at once; across 30 seeds the decoupled book won vol
  25/30, maxDD 24/30, Sharpe 21/30. → *Rule: the dial's authority stops at
  the Cycle Credit mandate's border (`creditWeightsFor`); the Core runs at
  fixed `CORE_GROSS`. Do not re-wire the dial into the Core "for elegance" —
  a signal's quality does not grant it sizing authority over books exposed to
  the factor it lags. Any re-coupling requires fresh multi-seed evidence.*

## Quality bars (checkable, not adjectives)

A change is done when ALL of these hold:

- [ ] `npm run build` exits 0.
- [ ] Headless Chromium on `dist/`: `document.querySelectorAll('section').length === 13`;
      zero console/page errors after excluding `/ERR_TUNNEL|Failed to load resource/`;
      key feature markers present case-insensitively.
- [ ] Determinism: any touched engine entry point run twice yields
      `JSON.stringify(a) === JSON.stringify(b)`.
- [ ] Purity: any touched engine module imports and executes in bare Node.
- [ ] Books balance: screen weights sum to ~100 when the book is non-empty;
      no position exceeds `SCREENS.maxName`; OMS routine rebalance fills with
      zero vetoes; season risk shares equal.
- [ ] Degradation: with no env vars, `/api/state` returns `{configured:false}`
      and the app renders identically to before the change.
- [ ] Disclaimers intact: `grep -ri "not investment advice" src/ | wc -l`
      is not lower than before the change.
- [ ] `CLAUDE.md` updated if the architecture map above changed.
- [ ] Committed with a what-and-why message; pushed to the working branch AND
      `main`.

## Design system constraints

Neoclassical: flat stone panels, 1px hairlines, one 2px accent rule at the
top edge, no rounded corners, no heavy shadows. Colors and fonts come ONLY
from `tokens.css` variables. Gilt is for thin rules and small marks, never
fills or data. The Greek-key meander appears exactly twice. Charts: ink lines
on stone, Wedgwood bands at 12%/24%, 5th percentile dashed terracotta, 95th
dashed laurel, mono axis labels. Interactive targets ≥ 40px; visible keyboard
focus; respect `prefers-reduced-motion`. The Gothic-diaper page background is
generated art — regenerate it with a script and screenshot it; don't hand-edit
the data URI.

## After every job (owner's standing instruction)

When a piece of work is delivered, do three things in the handoff, every time:

1. **Re-check the work adversarially** — not "did it build" but "what did I
   miss": race conditions, boundary cases the tests dodge, invariants
   honored in letter but not spirit. Fix what you find; report what you fixed.
2. **Name what the owner hasn't considered** relative to the stated goal
   (real capital, real investors, regulatory scrutiny) — governance gaps,
   audit gaps, operational risks. Blunt beats polite.
3. **Ask questions** — the decisions the work surfaced that are genuinely the
   owner's to make, with a recommendation each. Never end a job silent.

## Project skills

- `/verify` — the full verification pipeline (engine determinism + build +
  headless browser probe). Run before every commit.
- `/new-sleeve` — add an asset through the entire pipeline (universe → proxy
  → seasons → thesis → verification).
- `/backend-slice` — add a data source or endpoint with the guarded
  no-op-when-unconfigured pattern, fixture tests, and go-live docs.
