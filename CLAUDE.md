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

Single-page React app (Vite, no backend, no router). All market data is
simulated in-memory with a seeded PRNG (`mulberry32`) so results are
reproducible. The core state is a trail (last 6) of `{g, i}` surprise readings
in σ units, held in `src/App.jsx`; every module derives from the latest reading.

- `src/engine/` — pure logic, no React:
  - `prng.js` — mulberry32, Box–Muller normal, clamp
  - `machine.js` — surprise draws, priced-in constants, release tape, regime
    quadrants, the three gears, risk-of-ruin (ceiling 2.5%)
  - `assets.js` — 15-asset universe with ER/vol/βG/βI/carry, the scoring
    formula, five-tier ranking
  - `rules.js` — six IF/THEN Pure Alpha principles
  - `montecarlo.js` — equal-weight portfolio moments (pairwise ρ = 0.25),
    400-path GBM fan (fixed seed → identical elections reproduce identical
    fans), analytic lognormal ledger rows
- `src/live/fetchLive.js` — optional browser call to the Anthropic Messages API
  with the web-search tool; defensive JSON parsing; converts prints to surprise
  σ. Callers must catch and fall back to simulation.
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
