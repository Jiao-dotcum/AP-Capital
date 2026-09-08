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
  no leverage that breathes — the dial has no authority here. On top rides
  the **Pure Alpha overlay**: the six written principles as a vol-targeted
  tilt (4% annualized budget, gross ≤ 0.5, long-only after the clamp, total
  book gross still ≤ 1). It was wired only after clearing a pre-registered
  30-seed gate; re-tuning any of its constants requires re-running that
  gate before the change trades.
- **AP Cycle Credit (the Oaktree engine).** The Aggressiveness Dial (0–100,
  a percentile composite of seven credit-cycle proxies settled through a
  ±5-point deadband — Defense < 35, Neutral 35–65, Offense > 65) sizes ONLY
  this mandate's internal allocation across performing credit, distressed,
  and dry powder (`creditWeightsFor`). Defense hoards powder; offense
  deploys into despair. The performing sleeve's screen (`screenPerforming`)
  trades ten simulated issuers extended, since 2026-07-13, by real,
  live-verified names (Ford, Carnival, Occidental, American Airlines,
  Charter Communications, Macy's, Freeport-McMoRan, Community Health
  Systems, Pitney Bowes, Chemours — `BENCHMARKS`, `src/live/edgar.js`)
  whenever SEC EDGAR filings and Alpaca equity price history both clear
  every gate — see `docs/ENGINE_GUIDE.md` §6 for the KMV methodology and
  the two real 2026 Oaktree deals (Trinseo, Blue Racer Midstream) that
  don't fit a public-equity pipeline. A name that fails to
  clear is excluded from the traded book, never estimated.
- **Human ratification (the override)** may pin the dial at any value or
  resume automatic. Every override is an append-only record, and the run
  that obeys it says so inside the sealed decision (`decision.dialOverride`).
  The override inherits the dial's scope: it moves the credit mandate, never
  the Core. **Overrides expire after 30 days** unless re-ratified — a pinned
  dial is a decision, not a setting, and a forgotten one may not steer the
  book indefinitely.
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
   "reduce-only". **This rule is measured, not assumed.** A control arm runs
   the same Core strategy every day with the ceiling switched off —
   identical targets, marks and position caps, differing only in whether
   buys are halted — and the running gap between the two NAVs is what the
   ceiling has cost or saved since inception (`shadow.divergence`, sealed in
   every record; Section XII of the dashboard). The arm holds no capital,
   never trades, and never feeds a decision. Note what a short record can
   and cannot say: a hardstop earns its keep in the tail, so a sample
   without a severe drawdown in it cannot price the protection, only the
   foregone return. Treat the number as accumulating evidence, and do not
   relax the ceiling on a quiet-period reading of it.
3. **Dry powder**: the opportunistic sleeve deploys only when ≥ 2 of 3
   distress triggers arm (distress ratio > 10%, HY OAS > 700bp, forced-seller
   outflows). Until then powder stays powder.

## 5. Execution and P&L discipline

- **Cadence**: one canonical rebalance per trading day, after US close
  (21:30 UTC cron). No intraday trading. **Both mandates hold paper books**:
  the Core's OMS book (risk parity + Pure Alpha overlay) and the Cycle
  Credit ledger (performing screen + triggered distressed + powder, its own
  $1M NAV) — each journals its own trades with reasons and its own daily
  P&L, sealed in the same chained record. A day is journaled when the macro
  reading moved, the dial override changed, the traded universe changed, OR
  the closes moved — so a trading day with real P&L is never skipped merely
  because FRED was quiet, while re-running the ingest on identical inputs
  still appends nothing.
- **P&L is booked close-over-prior-close** — the full economic day including
  the overnight gap. Open→close is journaled alongside for the session tape.
  Attribution is per asset: the mark move on the position held *into* the
  day; today's fills start earning tomorrow.
- **Paper fills slip 4bp against the taker**; slippage is reported as
  `tradingCost` in every journal entry, never netted silently into P&L.
- **Marks**: real daily closes for every proxy the price feed covers,
  factor-modeled otherwise — and each record says which.
- **The decide-price and the fill-price are the same close — a known
  simplification.** Each run is one batch: mark yesterday's book to
  *today's* close, compute today's targets from today's reading, then fill
  the resulting orders at that *same* close. A real desk cannot do this —
  by the time today's closing print is known, the window to transact at it
  is already gone. Every fill here is therefore priced at a level that, in
  live trading, could only be approximated (next-open, or a market-on-close
  order submitted before the print). This is a standard backtest/paper-sim
  shortcut, not unique to the control arm, and it has never been stated
  outright before this line. It does not bias the ceiling measurement in
  §4.2 — the canonical and control books share the exact same fills, so the
  gap between them isolates the ceiling regardless. It DOES mean neither
  book's absolute return should be read as "what a live account would have
  earned" without that adjustment.
- **The next-open broker mirror measures exactly that adjustment.** The same
  run's Core target weights are also submitted to an **Alpaca paper account**
  as market-on-open orders (`time_in_force: opg`), so they fill at the *next*
  session's opening auction — a price nobody knows at decision time. It is
  gated on its own key pair (`ALPACA_PAPER_KEY_ID` /
  `ALPACA_PAPER_SECRET_KEY`, deliberately separate from the market-data
  keys), points at a hard-coded paper host so no configuration mistake can
  route it at real money, and sizes whole shares off the *real* account
  equity. It never feeds back into a decision. The broker book will NOT
  reproduce the paper book's numbers and is not meant to: **the gap between
  them is what the same-close shortcut is worth, in dollars, on a real
  venue** — the same logic as the control arm measuring the ruin ceiling
  instead of assuming it. Orders queued after the close cannot fill until
  the next open, so fills are reconciled on a *later* run; that lag is real
  T+1 settlement of information, not a defect.
  **It mirrors the control arm (§4.2), not the canonical book**, and is
  benchmarked against the arm's NAV. Both books target identical weights and
  differ only in whether the ruin ceiling halts buys; the broker does not
  apply that gate, so pairing it with the arm leaves exactly ONE difference —
  fill timing — while pairing it with the canonical book would confound fill
  timing with the ceiling and attribute neither. Each record seals which arm
  it mirrored, that arm's NAV, and the scale ratio between them. It sizes to
  99.5% of equity: an order sized off last night's close at 100% of equity is
  rejected whenever the open gaps up, and a target whose gross exceeds the
  1.0× Core ceiling is refused outright rather than sized into margin.
  Broker records live in their own append-only table and **cite** the run
  hash they mirror rather than being sealed inside it — a live venue's
  equity and fill prices are neither pure nor knowable at hash time, and
  putting them in the payload would make the chain unverifiable. The link is
  auditable; the chain stays provable.

## 6. The audit trail

Every run seals reading → decision → orders (with reasons) → P&L → risk
statement into `hash = sha256(prevHash | canonical-JSON(payload))`. The
chain refuses forks at the database level, `GET /api/chain` re-verifies
every link on demand, and anchoring the head hash externally (weekly curl,
email, git) makes the history provable, not just stored. Corrections are
new records; nothing historical is ever rewritten.

## 7. What this policy does NOT yet cover (open items)

- Real execution beyond the Alpaca paper mirror above (real capital requires
  counsel, an RIA/fund wrapper, and GIPS-aware performance).
- The broker mirrors the **Core** mandate only. The Cycle Credit ledger
  trades issuer-level bonds with no listed proxy, so it has no venue
  counterpart and stays paper-only.
- Liquidity risk (all proxies are liquid ETFs by Charter; revisit before
  any less-liquid sleeve).
- Counterparty/custody risk (no real broker yet).
