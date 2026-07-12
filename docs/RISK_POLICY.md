# Risk Management Policy — The Complete Machine

**Status: paper/own-capital only.** Everything below governs a simulated
paper book per the Charter. Nothing here is investment advice, and no figure
produced by the machine is a marketable track record. This document states
the standing rules; every daily engine run seals the *live values* of these
rules into its hash-chained journal record, so the policy and the practice
are auditable against each other.

## 1. Capital allocation — two mandates, one wall

The firm runs **two decoupled mandates with a fixed capital split** (Core 45 /
Credit 55). Each engine has exactly one jurisdiction; neither reaches into
the other's book. The wall exists because the walk-forward priced the old
coupling (the dial levering the whole book) and it cost return, volatility,
drawdown, and Sharpe simultaneously — across 30 seeded histories the
decoupled structure won on volatility 25/30, max drawdown 24/30, and Sharpe
21/30.

- **AP All Weather Core (the Bridgewater engine).** Four-season risk parity
  by standalone-vol equalization at a **fixed 1.0× gross**: the book balances
  *risk*, not capital, across Rising Growth, Falling Growth, Rising
  Inflation, and Falling Inflation. The check: season risk shares read
  ~25/25/25/25 every run (`risk.seasons` in the journal). No cycle timing,
  no leverage that breathes — the dial has no authority here.
- **AP Cycle Credit (the Oaktree engine).** The Aggressiveness Dial (0–100,
  a percentile composite of seven credit-cycle proxies settled through a
  ±5-point deadband — Defense < 35, Neutral 35–65, Offense > 65) sizes ONLY
  this mandate's internal allocation across performing credit, distressed,
  and dry powder (`creditWeightsFor`). Defense hoards powder; offense
  deploys into despair.
- **Human ratification (the override)** may pin the dial at any value or
  resume automatic. Every override is an append-only record, and the run
  that obeys it says so inside the sealed decision (`decision.dialOverride`).
  The override inherits the dial's scope: it moves the credit mandate, never
  the Core.
- **Every order carries its reason.** Rationale is generated at planning
  time from the same state that produced the order (mandate, strategy,
  regime, target vs. current weight, unified grade) and sealed with the
  trade — never reconstructed after the fact.

## 2. Position limits (pre-trade compliance)

| Rule | Limit |
|---|---|
| Single name | ≤ 25% of NAV |
| Single asset class | ≤ 45% of NAV |
| Gross exposure | ≤ 1.6× NAV, hard ceiling |
| Planning headroom | targets clip 10bp of NAV under every cap, so order rounding and intra-rebalance slippage drift cannot trip a false veto |

Caps clip targets at planning time; `preTrade` re-checks every order at
execution as the backstop. Sells always clear (they reduce risk). A routine
rebalance must produce zero vetoes — a veto is a signal, not housekeeping.

## 3. Tail risk — measured every run

Sealed into each journal record (`risk`):

- **Portfolio volatility** (annualized, from Ledoit–Wolf shrunk covariance).
- **CVaR / expected shortfall 95% and 99%** (monthly, % of book and in
  dollars) from a block bootstrap of the 22-year history — fat tails by
  resampling reality, not by assuming a distribution.
- **Named crisis replays** (GFC 2008–09, March 2020, 2022 both-down) run
  against *that day's actual weights*.
- **Risk-of-ruin** from the current macro-surprise magnitude.

## 4. De-risking rules — automatic, in order of severity

1. **Drawdown schedule**: > 5% peak-to-trough → gross to 75%; > 10% → gross
   to 50% with hedges on. Current drawdown and the binding rung are in every
   journal record.
2. **Ruin ceiling**: risk-of-ruin > 2.5% halts ALL new buys (sells still
   clear) until the reading normalizes. The journal marks these sessions
   "reduce-only".
3. **Dry powder**: the opportunistic sleeve deploys only when ≥ 2 of 3
   distress triggers arm (distress ratio > 10%, HY OAS > 700bp, forced-seller
   outflows). Until then powder stays powder.

## 5. Execution and P&L discipline

- **Cadence**: one canonical rebalance per trading day, after US close
  (21:30 UTC cron). No intraday trading. The canonical paper book is the
  **All Weather Core mandate's** book; the credit mandate's screen and
  powder posture are sealed in the decision but not yet routed to an OMS.
- **P&L is booked close-over-prior-close** — the full economic day including
  the overnight gap. Open→close is journaled alongside for the session tape.
  Attribution is per asset: the mark move on the position held *into* the
  day; today's fills start earning tomorrow.
- **Paper fills slip 4bp against the taker**; slippage is reported as
  `tradingCost` in every journal entry, never netted silently into P&L.
- **Marks**: real daily closes for every proxy the price feed covers,
  factor-modeled otherwise — and each record says which.

## 6. The audit trail

Every run seals reading → decision → orders (with reasons) → P&L → risk
statement into `hash = sha256(prevHash | canonical-JSON(payload))`. The
chain refuses forks at the database level, `GET /api/chain` re-verifies
every link on demand, and anchoring the head hash externally (weekly curl,
email, git) makes the history provable, not just stored. Corrections are
new records; nothing historical is ever rewritten.

## 7. What this policy does NOT yet cover (open items)

- Real execution (IBKR paper routing is the next phase; real capital after
  that requires counsel, an RIA/fund wrapper, and GIPS-aware performance).
- Liquidity risk (all proxies are liquid ETFs by Charter; revisit before
  any less-liquid sleeve).
- Counterparty/custody risk (no real broker yet).
- Override expiry — a pinned dial currently stands until explicitly resumed;
  a review-date discipline is recommended and not yet enforced in code.
