---
name: new-sleeve
description: Add a new asset/sleeve to The Complete Machine through the entire pipeline (universe betas, listed proxy, risk-parity seasons, docket thesis, verification). Use whenever asked to add an asset class, sleeve, ETF, or strategy to the universe (rates-curve, EM debt, equity factors, cat bonds, crypto, etc.).
---

# New Sleeve — an asset through the whole pipeline

A sleeve is not "added" until it flows through every stage: Register tiers →
grades → risk-parity book → Monte Carlo → paper OMS marks → Origination
docket. Five files, in this order. Skipping any step produces an asset that
silently misbehaves in one section.

## 1. `src/engine/assets.js` — the UNIVERSE row

Insert **immediately before the `cash` row** (cash stays last; insertion
position is a convention, and any insertion legitimately shifts every seeded
backtest/risk number downstream — say so in the commit message).

```js
{ id: 'xyz', name: 'Human Name', cls: 'ClassName', er: 5.0, vol: 12, bG: 0.3, bI: 0.2, bM: 0.4, carry: 1.5 },
```

Choosing parameters (all annual, in %):
- `er` — long-run expected CAGR, model assumption. Risk assets 5–8, hedges 3.5–5.
- `vol` — annualized. Look at the real proxy ETF's history for scale.
- `bG`/`bI` — growth/inflation surprise betas in σ units. Equities-like:
  bG ≈ +1, bI ≈ −0.5. Duration: bG ≈ −0.5, bI ≈ −1. Real assets: bI > 0.
- `bM` — the shared risk-on/off market beta (the correlation engine).
  Risk-on: +0.4…+1.2. Hedges/convexity: negative. Diversifiers: ≈ ±0.15.
- **Hard constraint:** monthly idiosyncratic variance must stay positive:
  `(vol/√12)² > (MARKET_VOL · bM)²`, i.e. **`vol ≥ 11.1 × |bM|`**
  (MARKET_VOL = 3.2). Violating it doesn't crash — `monthlyReturn` clamps
  idio variance to 0 and the asset silently becomes 100% systematic. Check it.
- `cls` — the OMS class-cap group (`LIMITS.maxClass` applies per distinct
  `cls` value). Reuse an existing class unless the sleeve genuinely deserves
  its own cap bucket.

`rankIntoTiers` auto-distributes any universe size; the Register, grades,
Execution grade column, and Tearsheet pick the asset up with no changes.

## 2. `src/engine/proxies.js` — the listed proxy

```js
xyz: { ticker: 'TICK', name: 'Short Proxy Name' },
```

Charter: listed, liquid ETFs only. The ticker joins the Alpaca daily-bars
request automatically (one request for all tickers).

## 3. `src/engine/risk.js` — seasons and cohort

- Add the id to every applicable `SEASONS` entry (an asset may appear in
  several — that's All Weather). Rising Growth = risk-on carry; Falling
  Growth = duration/convexity; Rising Inflation = real assets; Falling
  Inflation = equities + duration.
- If `bM > ~0.3`, add the id to `RISK_ON` (the crisis-correlation cohort).

## 4. `src/engine/origination.js` — the thesis (optional but preferred)

`macroThesis` has bespoke branches for special sleeves (see `vix`, `arb`).
Add one if the sleeve has a dial-dependent story; otherwise the generic
geared-to-regime thesis is generated automatically. The conviction/grade
comes from `grades.js` — **never** compute a score here.

## 5. Optional: `src/engine/firm.js`

If the sleeve deserves coverage in the decision feed, extend the
alternatives-analyst line (`Analyst · Volatility & Arb`) rather than adding a
new layer.

## Verification (all of it)

```bash
node scripts/verify.mjs
```

Plus sleeve-specific spot-checks in a scratch script:
- `rankIntoTiers(0.3, -0.2)` — tier sizes sum to the new universe count.
- `buildRiskReport([...assets incl. new one], 20)` vs `(…, 80)` — the new
  sleeve's weight responds to the dial in the intended direction.
- Idio-variance constraint: `(a.vol/Math.sqrt(12))**2 > (3.2*a.bM)**2`.
- If the default elected set should include it, update `DEFAULT_ELECTED` in
  `App.jsx` — otherwise leave defaults untouched.

Commit message must note: universe N→N+1, and that seeded backtest/risk
figures shift (deterministically) as a result.
