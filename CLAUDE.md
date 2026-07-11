# CLAUDE.md — Operating Manual for The Complete Machine

This file is the operating manual, not just a map. It encodes the conventions,
the named failure modes (each one actually happened), and the checkable
quality bars. Follow it exactly; when you change the architecture, update this
file in the same commit.

## What this is

A single-page React app (Vite, Vercel) simulating a Bridgewater × Oaktree
autonomous fund — macro regime reading, credit-cycle dial, risk-parity book,
credit screens, walk-forward backtest, paper-trading OMS, and an 8-layer agent
firm — plus a growing serverless backend (`api/`) that feeds it live FRED and
market data. The owner intends to raise real capital and route it through this
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

State lives in `src/App.jsx`: a trail of `{g, i}` macro-surprise readings (σ
units), a coupled credit-cycle object, the settled dial, the decision feed,
the paper book, and the point-in-time register. **`advanceWorld()` is the
single state transition** — the simulate path, the manual live path, and the
backend auto-load path all go through it. Never advance the world any other way.

- `src/engine/` — pure logic, no React, deterministic per reading:
  - `prng.js` — mulberry32, Box–Muller `normal`, `clamp`. All randomness
    everywhere flows from seeded mulberry32.
  - `machine.js` — surprise draws, `PRICED_IN` consensus constants, release
    tape, regime quadrants, three gears, risk-of-ruin (ceiling 2.5%).
  - `cycle.js` — credit-cycle evolution coupled to macro stress; seven proxies
    scored as **percentiles** in a rolling history (a seeded ten-year
    climatology + the session's cycle states); the Aggressiveness Dial settled
    through a ±5-point deadband (`settleDial`); five-sleeve anchor weights;
    dry-powder triggers (≥2 armed authorizes).
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
    equalization** (not ERC — see failure mode); dial scales gross 0.5×–1.5×;
    CVaR 95/99; drawdown de-risking schedule; block-bootstrap MC with named
    crisis replays.
  - `backtest.js` — 22y walk-forward, rules frozen at T, graded at T+1;
    per-principle/regime/dial hit rates; turnover with/without deadband;
    exposes the monthly return `series` and `windowStats(series, years)` for
    the lookback slider.
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
  `ingest.js` (daily cron: FRED keyless CSV + Alpaca IEX bars, **independent
  try/catch per source**), `state.js` (read endpoint), `_lib/db.js` (Postgres
  via `DATABASE_URL`, append-only tables, every function no-ops unconfigured),
  `_lib/ingest.js` + `_lib/marketdata.js` (pure transforms + thin fetch
  wrappers).
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
  routine rebalance must produce zero vetoes.*
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

## Project skills

- `/verify` — the full verification pipeline (engine determinism + build +
  headless browser probe). Run before every commit.
- `/new-sleeve` — add an asset through the entire pipeline (universe → proxy
  → seasons → thesis → verification).
- `/backend-slice` — add a data source or endpoint with the guarded
  no-op-when-unconfigured pattern, fixture tests, and go-live docs.
