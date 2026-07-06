# The Complete Machine

A single-page React dashboard simulating an autonomous fund built from two
opposed philosophies: **Bridgewater's engine diagnoses the environment;
Oaktree's engine decides how aggressive to be within it and picks the credit.**
Rendered in a neoclassical design language — Greek-revival restraint, stone
panels, a strong central axis.

Everything is driven by seeded state — macro surprises (growth/inflation, in σ)
and a coupled credit cycle — so every session is reproducible. No backend;
Phase 1 of the build plan, everything simulated.

## Sections

| § | Module | Engine | What it does |
|---|--------|--------|--------------|
| I | The Machine | Bridgewater | SVG macro compass (regime quadrants + trail), Three Gears, release tape (priced-in vs actual vs surprise) |
| II | The Cycle | Oaktree/Marks | Seven market-temperature proxies (HY OAS, CCC issuance, cov-lite %, distress ratio, flows, IPO heat, lender behavior) → despair scores → the **Aggressiveness Dial** (0 = max defense, 100 = max offense), with a Co-CEO override you ratify |
| III | Beta — All Weather | Bridgewater | Four seasonal sleeves at 25% risk vs the 60/40 capital illusion |
| IV | Alpha — Pure Alpha | Bridgewater | Six IF/THEN principles, FIRED or dormant |
| V | The Credit Desks | Oaktree | **Performing Credit** (Panossian): 10 issuers screened on coverage ≥ 2×, DD ≥ 2σ, spread-per-turn ≥ 90 bp, and the margin-of-safety gate; second-level thinking mechanized as market-vs-model spread divergence; sized by MoS. **Opportunistic** (O'Leary): dry powder, three distress triggers (deploys only when ≥ 2 arm), listed proxies (ETFs/BDCs/CEFs) since true distressed is not automatable |
| VI | The Register | Bridgewater | 15 holdings scored and re-ranked into five tiers; checkboxes elect the working portfolio |
| VII | The Allocation | Unified | Five sleeves interpolated between defensive/neutral/offensive anchors by the dial |
| VIII–IX | Monte Carlo & Ledger | — | 400-path GBM fan + analytic returns ledger for the elected book |
| X | The Firm | — | Eight agent layers (interns → the Memo); a live **decision feed** showing data pulls, screens, memos, PM proposals, risk vetoes, IC debate (three priors: perma-bear, macro-first, bottom-up-first), and Co-CEO joint sign-offs; plus the quarterly Marks-style **Memo** |
| XI | Safeguards | — | Risk-of-ruin monitor (2.5% ceiling) enforced by the Layer-4 risk agent; hardstop banner on breach |

## Live modes (Phase 2, bring your own Anthropic API key)

- **Fetch Live Macro Data** — calls the Anthropic Messages API (web-search
  tool) from the browser for the latest GDP, core CPI, policy rate, **and HY
  OAS**; converts prints to surprise σ, anchors the whole credit cycle to the
  real spread, and feeds the pipeline. Failures fall back to simulation with a
  visible status line.
- **Convene the Firm — Live** (Section X) — one API call has a real model act
  as the judgment layers: the three-persona IC debate (reasoning in the feed,
  gilt-ruled entries) and the quarterly Memo written in Marks' voice. Falls
  back to the simulated firm on any failure.

## The gallery

Five public-domain old masters are hotlinked from Wikimedia Commons and dressed
as numbered plates (stone frame, gilt fillet, sepia varnish): Wright of Derby's
*Air Pump* (the machine observed), Thomas Cole's *Course of Empire* — which
**swaps between Consummation / Arcadian / Destruction as the dial moves**,
Poussin's *A Dance to the Music of Time* (the seasons), David's *Oath of the
Horatii* (the firm's oath) and *Death of Socrates* (the refused override). If
an image is unreachable the plate withdraws itself; the page never breaks.

## Phase III — The Charter

The real-world constraints are encoded as standing articles in Section XI:
proxies only (true distressed doesn't automate), own capital only (outside
money means RIA registration and human oversight), and the judgment residual
(agents recommend, a human ratifies — the dial override is that checkpoint).

## Running

```sh
npm install
npm run dev       # http://localhost:5173
npm run build     # production build to dist/
npm run preview   # serve the production build
```

Fonts are self-hosted in `public/fonts/`; the page has no external runtime
dependencies.

## Disclaimer

All spreads, expected returns, issuers, and cycle readings are simulated model
assumptions for illustration. Nothing here is investment advice.
