# AP Credit Cycle Index (APCCI) — Methodology

**Version 1.0.0 · Base date 2026-07-22**

A daily, rules-based index of where the US credit cycle stands, on a fixed
scale from **0 (maximum froth)** to **100 (maximum despair)**.

This document is the complete specification. Anyone with a FRED account can
reproduce every published value to the decimal. That is the point: an index
whose numbers cannot be independently recomputed is an opinion, not an index.

**This is not investment advice.** The index measures market conditions. It
does not forecast returns, and no performance is claimed or implied.

---

## 1. What it measures

Howard Marks' framing: you cannot predict the credit cycle, but you can know
where you stand in it. When spreads are tight, lenders accommodating, and
risk appetite high, compensation for bearing credit risk is poor — and the
opposite in a panic. APCCI is a single number for that position.

| Range | Band | Reading |
|---|---|---|
| 0–20 | Extreme Froth | Risk priced for perfection. Historically the worst time to add credit risk. |
| 20–35 | Froth | Tight spreads, accommodating lenders. Below-average compensation. |
| 35–65 | Neutral | Mid-cycle. Neither fear nor greed is being paid for. |
| 65–80 | Stress | Above-average compensation. Selective deployment. |
| 80–100 | Despair | The market pays well for risk. Historically the best time to add. |

---

## 2. Inputs

Five public series. Every one is free, published on a known schedule, and
downloadable from [FRED](https://fred.stlouisfed.org).

| Component | FRED series | Unit | Weight |
|---|---|---|---|
| US High Yield OAS | `BAMLH0A0HYM2` | bp | 35% |
| CCC & Lower OAS | `BAMLH0A3HYC` | bp | 25% |
| Investment Grade OAS | `BAMLC0A0CM` | bp | 15% |
| National Financial Conditions Index | `NFCI` | index | 15% |
| CBOE Volatility Index | `VIXCLS` | points | 10% |

**Why these five.** High yield OAS is the core price of credit risk and takes
the largest weight. CCC OAS captures the deep end, where dispersion appears
first and where distressed opportunity actually lives. IG OAS measures
breadth — when investment grade widens materially, stress has stopped being a
high-yield story and become a system story. NFCI adds funding and leverage
conditions the spread series do not see. VIX proxies risk appetite and takes
the smallest weight deliberately: it is an equity measure and spikes on
events that leave credit untouched.

**Units.** FRED publishes the three OAS series in **percent**; they are
converted ×100 to basis points before scoring. NFCI and VIX are used as
published.

---

## 3. Scoring

Each component's raw value is mapped to a 0–100 score by **piecewise-linear
interpolation** between fixed anchor points, then combined by the weights
above. Outside the end anchors the score is flat, never extrapolated.

### Anchor tables

**US High Yield OAS (bp)**

| bp | 250 | 325 | 400 | 475 | 600 | 800 | 1100 | 2000 |
|---|---|---|---|---|---|---|---|---|
| score | 0 | 12 | 28 | 50 | 68 | 82 | 93 | 100 |

**CCC & Lower OAS (bp)**

| bp | 450 | 650 | 800 | 1000 | 1400 | 1900 | 2600 | 4000 |
|---|---|---|---|---|---|---|---|---|
| score | 0 | 15 | 30 | 50 | 72 | 87 | 95 | 100 |

**Investment Grade OAS (bp)**

| bp | 70 | 95 | 115 | 138 | 175 | 230 | 330 | 600 |
|---|---|---|---|---|---|---|---|---|
| score | 0 | 15 | 30 | 50 | 70 | 85 | 95 | 100 |

**NFCI (index level)**

| level | −1.0 | −0.7 | −0.55 | −0.4 | −0.1 | 0.5 | 1.5 | 3.0 |
|---|---|---|---|---|---|---|---|---|
| score | 0 | 15 | 30 | 50 | 68 | 85 | 95 | 100 |

**VIX (points)**

| points | 10 | 13 | 16 | 19 | 25 | 33 | 45 | 65 |
|---|---|---|---|---|---|---|---|---|
| score | 0 | 15 | 30 | 50 | 70 | 85 | 95 | 100 |

### Worked example

At HY OAS 450bp, CCC 900bp, IG 130bp, NFCI 0.00, VIX 20:

| Component | Raw | Score | Weight | Contribution |
|---|---|---|---|---|
| HY OAS | 450 | 42.67 | 0.35 | 14.93 |
| CCC OAS | 900 | 40.00 | 0.25 | 10.00 |
| IG OAS | 130 | 43.04 | 0.15 | 6.46 |
| NFCI | 0.00 | 70.83 | 0.15 | 10.62 |
| VIX | 20 | 53.33 | 0.10 | 5.33 |
| **APCCI** | | | | **47.35** (Neutral) |

Every published value ships with this table, so the arithmetic can be checked
without running any code.

---

## 4. Calibration — and its honest limits

Anchors are calibrated so that the index ranks real historical episodes in
the order history actually placed them, with the long-run median of each
series near 50:

| Episode | APCCI | Band |
|---|---|---|
| June 2007 — the tights | 5.7 | Extreme Froth |
| December 2021 — post-COVID froth | 18.1 | Extreme Froth |
| October 2018 — mid-cycle | 39.1 | Neutral |
| September 2011 — euro crisis | 81.3 | Despair |
| March 2020 — COVID crash | 91.5 | Despair |
| December 2008 — GFC peak | 99.6 | Despair |

*(Computed from approximate published levels for those dates, as a
calibration check — not published index values. The index's live history
begins at the base date.)*

**What this calibration is not.** The anchors were set from named historical
episodes and approximate long-run medians. They have **not** been fitted to
the full historical distribution of each series. A rigorous percentile
recalibration against complete FRED history is the intended v1.1. Until then,
the defensible claim is *ordering and rough level*, not precision about any
single reading — and band membership near a boundary (September 2011 sits
essentially on the stress/despair line) should be read as approximate.

---

## 5. Publication rules

1. **Daily**, after the US close, when all five inputs are available.
2. **Incomplete inputs publish nothing.** An index computed from four of five
   components is a different index; publishing it under the same name would
   be a silent methodology change. The missing series is recorded instead.
3. **An implausible input is treated as missing, not clamped.** A HY OAS of
   8bp is a broken feed, and scoring it 0 would publish a confident froth
   reading off bad data.
4. **Values are final and never revised.** Once published for an observation
   date, a value stands permanently, even if an input series is later
   restated by its publisher. Corrections appear as new observations, never
   as edits to history. This is enforced in the database, not by convention:
   the write is `ON CONFLICT DO NOTHING` against a unique key on
   `(ticker, version, obs_date)`.
5. **The specification is frozen within a version.** Any change to inputs,
   weights, or anchors requires a new version number and is published as a
   separate series. The old series is never retroactively recomputed.

---

## 6. Reading the index

```
GET /api/index-value            → latest value, components, methodology
GET /api/index-value?history=1  → the full published series
GET /api/index-value?spec=1     → the frozen specification
```

Public and unauthenticated. Every response includes the component breakdown
behind the value.

---

## 7. Known limitations

- **US only.** No European or emerging-market credit.
- **Five inputs.** Deliberately few, all public. Issuance quality, covenant
  quality, and lender surveys would improve it but are not freely available
  daily, and an index that cannot be recomputed by a reader is worth less
  than one with fewer inputs that can.
- **NFCI is weekly**, the rest daily. Between NFCI releases the most recent
  published value is carried, so the index moves on four series on most days.
- **Calibration is episode-based**, not distribution-fitted — see §4.
- **No forecast content is claimed.** Whether the index's level predicts
  subsequent credit returns is an open empirical question, and testing it
  properly requires history the index does not yet have.
