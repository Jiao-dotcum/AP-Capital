# Scope: a fully rigorous AP Cycle Credit backtest

**Status: items 1, 2, 3, and 5 SHIPPED** in `src/engine/creditBacktest.js`
(owner approved the build). Item 4 — validation against real historical
data — remains open and is the honest gap between "a rigorous model" and
"a validated one."

## What is built (v2, the full-rigor walk)

1. **Time-varying issuer fundamentals** ✅ — each issuer's `lev`/`cov`/`mult`
   follow monthly mean-reverting, cycle-linked paths (leverage creeps up
   when `lenderEase` says money is chasing deals; coverage erodes and EV
   multiples compress as spread stress rises), drawn from that issuer's own
   seeded `mulberry32` stream per Invariant 3.
2. **Ratings migration & default, realized** ✅ — the `TRANSITION` matrix
   monthly-ized (`p_m = 1 − (1−p)^(1/12)`) and actually rolled per issuer
   per month. Default intensity is modulated by cycle stress
   (`0.6 + 1.8·s`) and by the issuer's *current* Merton distance-to-default
   (`exp(1.1·(2.2 − DtD))`, clamped [0.35, 3.5]) so the screen's gates face
   an adversarial test. A defaulted issuer realizes `(recovery − price)/price`
   on the held weight, then reorganizes to its snapshot balance sheet.
3. **A real position ledger** ✅ — the book holds last screen's weights into
   each month: carry (rf + spread accrual) + price mark-to-market off the
   screen's own price series, realized default losses, and 25bp one-way
   trading cost on turnover (HY cash round trip ≈ 50bp, stylized).
4. **Historical validation** ❌ OPEN — the synthetic issuer paths are
   calibrated to agency through-the-cycle rates but have not been validated
   against real historical HY spread/default behavior by rating bucket
   (FRED has the bucket-level OAS series). Until that's done this is a
   model of a model — every number it produces is labeled as such.
5. **verify.mjs checks** ✅ — determinism, purity, no-NaN, defaults > 0
   (a 22-year HY path with zero defaults means the engine is broken; that
   exact bug shipped once as a NaN DtD and the check now catches it), and
   the discrimination floor: the rejected cohort's realized default rate
   must be ≥ the held book's. Canonical seed: held 1.2%/yr vs rejected
   11.1%/yr; the inequality held on 20/20 test seeds.

## Duration & cost assumptions (source-checked July 2026)

- HY effective duration has ranged ~3.0–4.5y over two decades (HYG ≈ 2.9y
  today); performing-book MTM comes off the screen's own price series so no
  duration constant is needed there anymore.
- CLO BB debt is floating-rate: rate duration ≈ 0, **spread** duration used
  4.5y (`DISTRESSED_SPREAD_DURATION`).
- Trading cost 25bp one-way (`TRADE_COST_BP`).

## What item 4 requires, when it's picked up

Pull FRED's bucket-level HY OAS history (BAMLH0A1HYBB / H0A2HYB / H0A3HYC)
through the existing backend seam, then compare: synthetic spread levels and
widening episodes by bucket vs realized; synthetic default incidence vs
agency annual default studies; and the screen's price series vs real
drawdown depth in 2008/2020 analogues. Divergences become recalibrations of
the constants in `creditBacktest.js`, each called out in a commit.
