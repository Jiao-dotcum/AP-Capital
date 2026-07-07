# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm install` — install dependencies
- `npm run dev` — Vite dev server at http://localhost:5173
- `npm run build` — production build to `dist/`
- `npm run preview` — serve the production build

There is no test framework or linter configured. Verify changes by building and
loading the page in a browser (the repo has been checked with headless Chromium
at `/opt/pw-browsers/chromium` via `playwright-core`).

## Architecture

Single-page React app (Vite, no backend, no router) simulating a
Bridgewater × Oaktree autonomous fund. All market data is simulated in-memory
with a seeded PRNG (`mulberry32`) so results are reproducible. Core state lives
in `src/App.jsx`: a trail (last 6) of `{g, i}` macro surprise readings in σ
units, plus a coupled credit-cycle object, an accumulating agent decision feed,
and an optional Aggressiveness Dial override. `advanceWorld()` in `App.jsx` is
the single state transition shared by the simulate and live-fetch paths — every
release evolves the cycle, re-screens the credit desks, recomputes the dial and
sleeve weights, and generates one pass of decision-feed entries.

- `src/engine/` — pure logic, no React:
  - `prng.js` — mulberry32, Box–Muller normal, clamp
  - `machine.js` — surprise draws, priced-in constants, release tape, regime
    quadrants, the three gears, risk-of-ruin (ceiling 2.5%)
  - `cycle.js` — Oaktree layer: credit-cycle evolution (coupled to macro
    stress), seven market-temperature proxies scored as percentiles in a
    rolling history (a seeded ten-year climatology plus the session's cycle
    states) → the Aggressiveness Dial, settled through a ±5-point deadband
    (`settleDial`) so it doesn't whipsaw; five-sleeve anchor allocations
    interpolated by dial, dry-powder deployment triggers (≥ 2 armed
    authorizes)
  - `credit.js` — 10-issuer performing-credit universe from structural
    fundamentals (leverage, coverage, EV multiple, asset volatility, recovery);
    Merton distance-to-default computed from asset value/vol, PD via an
    empirically-calibrated DtD→default map (KMV-style, since the Gaussian tail
    is miscalibrated), expected-loss pricing (PD × LGD) as the model-fair
    spread; screens (coverage, DtD, spread-per-turn, margin-of-safety gate);
    market vs model divergence (second-level thinking); a one-year
    ratings-transition matrix; MoS-based sizing with single-name/sector
    concentration caps at the gate; opportunistic proxy vehicles. Deterministic
    per cycle print (hash, not rng)
  - `firm.js` — the 8-layer agent hierarchy roster, per-release decision-feed
    builder (intern → analyst → memo → desk PMs → risk veto → IC debate with
    three fixed priors → Co-CEO sign-off), and the quarterly Marks-style memo
    generator (quarters advance every 3 releases)
  - `assets.js` — 15-asset universe with ER/vol/βG/βI/βM/carry, the scoring
    formula, five-tier ranking, and the shared model-consistent return
    generator (`monthlyReturn`): macro-factor response + a stress-amplified
    shared market shock (the correlation engine) + idiosyncratic noise
  - `risk.js` — real risk math on the elected book: Ledoit–Wolf-shrunk
    covariance from the 22-year monthly history (replacing flat ρ), risk-on
    crisis-vs-calm correlation, four-season risk-parity sizing (standalone-vol
    equalization, robust to hedge sleeves) with the dial scaling gross
    0.5×–1.5×, CVaR (95/99% expected shortfall), a drawdown-triggered
    de-risking schedule, and a block-bootstrap Monte Carlo (six-month blocks
    → fat tails) with named crisis replays (2008, Mar-2020, 2022)
  - `origination.js` — the Origination Desk: composite conviction scores
    (regime fit, cycle-posture fit, carry, risk-adjusted premium, credit
    divergence) → the ranked best-ideas docket (top 8); folds in the sourcing
    engine's gate-passing leads; nominates only, never sizes
  - `sourcing.js` — the sourcing engine: a catalyst scanner (fallen angels,
    index deletions, spinoffs, post-bankruptcy relistings, insider clusters,
    CEF discounts) firing off the cycle state; a forced-seller detector (flow
    capitulation in σ, margin-pressure and stress proxies → an intensity
    score); and a hard second-level gate — every lead needs a written
    consensus view, why-consensus-is-wrong, and kill condition, or it is HELD.
    Deterministic per cycle print
  - `pit.js` — append-only point-in-time register: every live input stored
    with its observation date and the knowable-at timestamp; `pitLatest` reads
    only what was knowable at T (lookahead-proof); serialized to localStorage
    by App.jsx
  - `rules.js` — six IF/THEN Pure Alpha principles
  - `backtest.js` — walk-forward proving ground: 22 years of monthly releases
    (fixed seed, expanding percentile history, the same dial deadband), rules
    frozen at T and graded strictly at T+1 against a model-consistent return
    generator; reports per-principle hit rates, regime hit rates, dial
    posture hit rates, turnover with/without the deadband, and book
    CAGR/vol/max-drawdown; the quarterly Memo quotes these base rates
  - `montecarlo.js` — equal-weight portfolio moments (pairwise ρ = 0.25
    fallback), 400-path GBM fan (fixed seed → identical elections reproduce
    identical fans); accepts override moments so the fan can be driven by the
    risk-parity book on the Ledoit–Wolf covariance from `risk.js`; analytic
    lognormal ledger rows
- `src/live/fred.js` — primary live path: one Messages API call with the
  web_fetch server tool retrieves an exact `fredgraph.csv` (GDPNow, CPI,
  Cleveland Fed 1y expected inflation, DGS1, DFF, HY OAS — FRED quotes OAS in
  percent, converted ×100 to bp); the raw CSV is parsed deterministically
  client-side, never paraphrased by the model. Surprises read actual vs
  market: CPI YoY vs EXPINF1YR, effective funds vs the 1y-Treasury-implied
  path; growth vs the documented consensus constant. Emits point-in-time
  records for `pit.js` and a real-print tape for Releases.
- `src/live/fetchLive.js` — secondary live path: browser call to the Anthropic
  Messages API with the web-search tool (GDP, CPI, policy rate, HY OAS);
  defensive JSON parsing; converts prints to surprise σ and anchors the cycle
  via `cycleFromSpread`. The chain is FRED → web search → simulation, with the
  active source named in the status line.
- `src/live/edgar.js` — optional live credit fundamentals: one web_fetch
  Messages API call per benchmark issuer retrieves its SEC EDGAR companyfacts
  XBRL (data.sec.gov sends no CORS headers, same as FRED); coverage and
  leverage are parsed deterministically from the filings and run through the
  same Merton → PD → expected-loss pipeline as the simulated desk. Per-issuer
  fallback to offline structural estimates.
- `src/live/convene.js` — optional live-firm call: one Messages API request
  returns the IC debate votes and a Marks-voice memo as JSON; defensively
  parsed; callers fall back to the simulated firm.
- `src/components/art.jsx` — the plate gallery: public-domain paintings
  hotlinked from Wikimedia Commons (candidate-URL fallback per plate; a plate
  that cannot load withdraws itself so the layout never breaks). The Cole
  plate in Section II swaps by dial posture.
- `src/components/` — one component per dashboard section plus `chrome.jsx`
  (masthead, meander, section heads, dividers, hardstop banner, footer)
- `src/styles/tokens.css` — the neoclassical design tokens (palette, type
  scale). **All colors and fonts live here**; components reference only CSS
  variables. `app.css` holds the structural styles.
- `public/fonts/` — self-hosted latin woff2 subsets + `fonts.css` (no external
  font requests at runtime)

## Design system constraints

Neoclassical: flat stone panels with 1px hairlines and a single 2px accent rule
at the top edge, no rounded corners, no heavy shadows, no gradients beyond the
faint page wash. Gilt (`--gilt`) is used only for thin rules and small marks,
never fills or data. The Greek-key meander appears exactly twice (under the
masthead, above the footer). Charts: ink lines on stone, Wedgwood bands at
12%/24% opacity, 5th percentile dashed terracotta, 95th dashed laurel, mono
axis labels. Keep interactive targets ≥ 40px, keyboard focus visible, and
respect `prefers-reduced-motion`.
