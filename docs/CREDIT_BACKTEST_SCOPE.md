# Scope: a fully rigorous AP Cycle Credit backtest

**Status: not built.** `src/engine/mandateBacktest.js` ships a v1 estimate
(below) that is meaningfully more real than an ETF-ticker proxy but still
short of what "backtest the actual credit desk" should mean. This document
scopes the difference.

## What v1 does (shipped)

Walks the real `screenPerforming(cycle)` engine month by month over the same
22-year seeded path as everything else: at each step, screens the ten
structural issuers against that month's cycle state, sizes the performing
sleeve by margin-of-safety weight exactly as the live desk would, and prices
carry minus duration-adjusted mark-to-market off each issuer's *screened*
market spread. The distressed sleeve prices off the same CLO BB Debt proxy
formula `proxyVehicles()` already quotes (1.55× HY OAS), gated by the same
`deployAuthorized` trigger logic the live desk uses, and sits in cash
otherwise. The credit-mandate blend uses `creditWeightsFor(dial)`, lagged one
period exactly as the legacy backtest's `pending` structure — no lookahead.

**The gap**: each issuer's structural inputs (`lev`, `cov`, `mult`, `av`,
`recovery`) are a fixed snapshot. `screenPerforming` re-derives distance-to-
default and the model-fair spread fresh each cycle print, but the *inputs*
never evolve — Meridian Cable has the same leverage and coverage in year 1
and year 22. Real issuers lever up in booms, delever in busts, and some of
them actually default. None of that is in v1.

## What full rigor requires

1. **Time-varying issuer fundamentals.** Each of the ten (or more) issuers
   needs its own 22-year path for `lev`, `cov`, `mult`, `av` — plausibly
   mean-reverting and macro-linked (leverage drifts up in easy-credit
   regimes, down under refinancing pressure), drawn from **its own seeded
   `mulberry32` stream** per Invariant 3 (new randomness, own generator —
   never reuse the macro/cycle draw sequence).
2. **Ratings migration, realized.** `credit.js` already has the one-year
   transition matrix (`TRANSITION`, `migrationOf`) but nothing currently
   *rolls the dice* — a real backtest needs each issuer to actually migrate
   (or default) probabilistically each period, with its own seeded stream,
   and a position ledger that realizes the loss (`1 − recovery/100` of
   par) the period a default hits.
3. **A real position ledger**, not a re-screened snapshot: entries, exits,
   accrued carry between rebalances, transaction costs on turnover (the
   Charter's discipline — nothing here is free to trade), and mark-to-market
   between screens rather than only at the print.
4. **Historical spread data, not synthetic.** The live path already has the
   seam (`src/live/edgar.js`, SEC XBRL fundamentals) — a rigorous backtest
   should eventually validate the synthetic issuer paths against real
   historical HY-index spread behavior by rating bucket (FRED has this),
   the same discipline `docs/BACKEND.md` already applies to the live feed.
5. **Its own `verify.mjs` checks**: determinism (same seed ⇒ same defaults,
   same realized losses), purity (bare Node), and a sanity floor — a desk
   that rejects issuers below the margin-of-safety gate should show realized
   defaults concentrated in whatever *did* clear the gate versus what didn't,
   or the screen itself isn't measuring anything.

## Why this is its own project, not a v1.5 patch

Items 1–2 need new modeling assumptions the owner should approve explicitly
(how fast does leverage drift? what triggers a downgrade beyond the fixed
transition matrix?) before they're load-bearing evidence for a real product.
Scope it as its own slice when the Cycle Credit mandate is ready to carry
real capital — v1's honest proxy is enough to reason about *shape*
(concentrated, patient, higher-vol) today.
