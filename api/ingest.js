import dns from 'node:dns'
import { fetchFredState, fredApiKeyConfigured } from './_lib/ingest.js'
import { marketConfigured, fetchPrices } from './_lib/marketdata.js'
import { secConfigured, fetchFundamentals } from './_lib/edgar.js'
import { buildRealIssuers } from './_lib/realIssuers.js'
import { runEngineStep, unchangedSinceRun } from './_lib/engine.js'
import { anchorConfigured, anchorChainHead } from './_lib/anchor.js'
import { brokerConfigured, stepBroker } from './_lib/broker.js'
import { computeIndex, bandOf, INDEX_TICKER } from '../src/engine/creditIndex.js'
import {
  configured,
  ensureSchema,
  insertObservations,
  saveState,
  insertPrices,
  insertFundamentals,
  insertEngineRun,
  getLatestRun,
  getLatestDialOverride,
  insertIndexValue,
  insertBrokerRun,
} from './_lib/db.js'

// A clean N-second timeout with no DNS/connection error first (as opposed to
// a fast ENOTFOUND/ECONNREFUSED) is the signature of a broken IPv6 path in a
// serverless container: the runtime tries to resolve/connect over IPv6
// first, that route is dead, and the fetch hangs until the abort fires
// instead of falling back to IPv4 quickly. Force IPv4-first resolution for
// every outbound fetch this function makes (FRED, Alpaca) — set once at
// module load so it applies for the life of the warm container.
dns.setDefaultResultOrder('ipv4first')

// Allow up to 30s (Vercel clamps to whatever the plan permits) — the default
// function timeout can otherwise cut off a slow upstream before its own
// fetch-level timeout in _lib/ingest.js has a chance to report why.
export const maxDuration = 30

// ————— Scheduled ingestion (Vercel Cron → this endpoint) —————
// Pulls FRED (macro, keyless CSV) and, if configured, Alpaca (real closes for
// the listed proxies) — independently, so one source failing doesn't block the
// other. Stores everything point-in-time and appends one machine-state
// snapshot. Runs on the schedule in vercel.json; can also be hit manually.
export default async function handler(req, res) {
  // If a CRON_SECRET is configured, require it (Vercel Cron sends it as a
  // Bearer token). Before it is set, the endpoint is open — set it before go-live.
  const secret = process.env.CRON_SECRET
  if (secret && req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ error: 'unauthorized' })
  }

  const out = {
    ok: true,
    configured: configured(),
    marketConfigured: marketConfigured(),
    fredApiKeyConfigured: fredApiKeyConfigured(),
    secConfigured: secConfigured(),
  }
  if (configured()) await ensureSchema()

  // Independent of FRED/Alpaca/DB: a fast, unrelated, highly-reliable host
  // tells apart "FRED specifically is unreachable/blocked" from "outbound
  // networking is broken for this deployment entirely."
  try {
    const t0 = Date.now()
    const probe = await fetch('https://api.github.com/zen', { signal: AbortSignal.timeout(8_000) })
    out.networkProbe = { ok: probe.ok, ms: Date.now() - t0 }
  } catch (err) {
    out.networkProbe = { ok: false, error: String(err.message || err) }
  }

  // Macro (FRED)
  let fredState = null
  try {
    fredState = await fetchFredState()
    out.knownAt = fredState.knownAt
    out.prints = fredState.prints
    if (configured()) {
      out.observationsStored = await insertObservations(fredState.records)
      await saveState(fredState)
    }
  } catch (err) {
    out.ok = false
    out.fredError = String(err.message || err)
  }

  // Market prices (Alpaca) — independent of the macro fetch above.
  let prices = null
  if (marketConfigured()) {
    try {
      prices = await fetchPrices()
      out.tickersFetched = Object.keys(prices).length
      if (configured()) out.pricesStored = await insertPrices(prices)
    } catch (err) {
      out.ok = false
      out.marketError = String(err.message || err)
    }
  }

  // Credit fundamentals (SEC EDGAR) — keyless, but gated on SEC_USER_AGENT
  // (SEC requires an identifying User-Agent). Independent of the feeds above.
  let edgarRows = null
  if (secConfigured()) {
    try {
      edgarRows = await fetchFundamentals()
      out.issuersParsed = edgarRows.filter((r) => !r.error).length
      // A partial failure (some issuers, not all) previously vanished into a
      // bare count — surface which name and why, or a silent per-issuer
      // error is undiagnosable from the outside.
      const failed = edgarRows.filter((r) => r.error)
      if (failed.length) out.edgarIssuerErrors = failed.map((r) => `${r.ticker}: ${r.error}`)
      if (configured()) out.fundamentalsStored = await insertFundamentals(edgarRows)
    } catch (err) {
      out.ok = false
      out.edgarError = String(err.message || err)
    }
  }

  // The real trading desk (2026-07-13): KMV-unlever the SAME EDGAR
  // fundamentals just fetched above against live Alpaca equity price
  // history — independent try/catch so a market-data hiccup doesn't blank
  // fundamentals and vice versa. A name that doesn't clear every gate is
  // excluded from the traded book (out.realIssuerErrors), never estimated.
  let realIssuers = null
  if (edgarRows && marketConfigured()) {
    try {
      const built = await buildRealIssuers(edgarRows)
      realIssuers = built.issuers
      out.realIssuersTraded = built.issuers.map((r) => r.id)
      if (built.errors.length) out.realIssuerErrors = built.errors
    } catch (err) {
      out.ok = false
      out.realIssuerError = String(err.message || err)
    }
  }

  // Phase 2: the canonical engine run — needs a fresh reading and the DB
  // (the chain is the whole point; without persistence there is nothing to
  // append to). Skipped silently when either is missing; a repeat curl with
  // unchanged FRED data AND an unchanged dial override records nothing (the
  // chain logs decisions, not curls). The override is the human-ratified dial
  // from /api/override — The Charter's ratification, applied canonically.
  let engineRun = null
  if (configured() && fredState?.reading) {
    try {
      const prevRun = await getLatestRun()
      const override = await getLatestDialOverride()
      // A pinned dial is a decision, not a setting: it expires after 30 days
      // unless re-ratified, so a forgotten override can't steer the credit
      // mandate indefinitely. Expiry is surfaced in the response.
      const OVERRIDE_TTL_DAYS = 30
      const overrideFresh =
        override?.dial != null &&
        override.setAt != null &&
        Date.now() - new Date(override.setAt).getTime() < OVERRIDE_TTL_DAYS * 864e5
      if (override?.dial != null && !overrideFresh) out.overrideExpired = true
      const inputs = {
        reading: fredState.reading,
        hyOasBp: fredState.hyOasBp ?? null,
        knownAt: fredState.knownAt,
        prices,
        dialOverride: overrideFresh ? override.dial : null,
        realIssuers,
      }
      if (unchangedSinceRun(prevRun, inputs)) {
        out.engineRun = { unchanged: true, seq: prevRun.seq, hash: prevRun.hash.slice(0, 12) }
      } else {
        const run = runEngineStep(prevRun, inputs)
        const inserted = await insertEngineRun(run)
        if (inserted) engineRun = run
        out.engineRun = {
          seq: run.seq,
          nav: run.nav,
          dial: run.decision.dial,
          filled: run.decision.filled,
          vetoed: run.decision.vetoed,
          hash: run.hash.slice(0, 12),
          inserted,
        }
      }
    } catch (err) {
      out.ok = false
      out.engineError = String(err.message || err)
    }
  }

  // ————— The Alpaca PAPER broker mirror (next-open execution) —————
  // The paper book decides and fills at the SAME close (docs/RISK_POLICY.md
  // §5), which no real account can do. This submits the same run's target
  // weights to a real venue as market-on-open orders, filling at the next
  // session's opening auction — a price nobody knows at decision time. The
  // gap between the two books is the measurement: what the same-close
  // shortcut is worth in dollars.
  //
  // Runs ONLY on a freshly-inserted run (a quiet day produced no new
  // decision, so there is nothing new to mirror), and only when the prices
  // that priced the decision are in hand. Its own try/catch: the venue is
  // downstream of everything: a broker outage must never fail the run that
  // produced the data, and it never feeds back into a decision.
  out.brokerConfigured = brokerConfigured()
  if (brokerConfigured() && engineRun && prices) {
    try {
      const weights = engineRun.decision.coreTargetWeights
      if (!weights) throw new Error('run sealed no coreTargetWeights')
      const step = await stepBroker({ seq: engineRun.seq, weights, prices })
      const recorded = configured()
        ? await insertBrokerRun({
            seq: engineRun.seq,
            runHash: engineRun.hash,
            knownAt: engineRun.knownAt,
            equity: step.equity ?? null,
            payload: step,
          })
        : false
      out.broker = {
        recorded,
        seq: engineRun.seq,
        equity: step.equity,
        submitted: step.submitted?.length ?? 0,
        rejected: step.rejected?.length ?? 0,
        fillTiming: step.fillTiming,
      }
      // A rejection is information, not noise — surface the reasons.
      if (step.rejected?.length) out.brokerRejections = step.rejected.map((o) => `${o.side} ${o.qty} ${o.ticker}: ${o.reason}`)
    } catch (err) {
      out.brokerError = String(err.message || err)
    }
  }

  // The published index (APCCI). Its own try/catch: the index is a
  // publication, and a publishing failure must not fail the run that
  // produced the data. Incomplete inputs publish NOTHING for the day rather
  // than a partial value computed from a different set of components.
  if (fredState?.indexInputs) {
    try {
      const idx = computeIndex(fredState.indexInputs)
      if (!idx.complete) {
        out.index = { published: false, reason: 'incomplete inputs', missing: idx.missing }
      } else {
        const obsDate = fredState.indexObsDate ?? fredState.knownAt.slice(0, 10)
        const band = bandOf(idx.value).band
        const published = configured()
          ? await insertIndexValue({
              ticker: INDEX_TICKER, version: idx.version, obsDate,
              value: idx.value, band, components: idx.components, knownAt: fredState.knownAt,
            })
          : false
        // published:false with a value present = this obs_date was already
        // final. Not an error — the index refusing to restate itself.
        out.index = { published, value: idx.value, band, obsDate, version: idx.version }
      }
    } catch (err) {
      out.indexError = String(err.message || err)
    }
  }

  // External anchor: commit the chain head to a repo we don't control, so
  // the head hash is timestamped by a third party and cannot be backdated.
  // Runs AFTER the engine step (it anchors whatever the head now is) and in
  // its own try/catch — an anchoring failure is a publishing problem, never
  // a reason to fail the run that produced the data.
  out.anchorConfigured = anchorConfigured()
  if (configured() && anchorConfigured()) {
    try {
      const head = await getLatestRun()
      out.anchor = await anchorChainHead(head)
    } catch (err) {
      out.anchorError = String(err.message || err)
    }
  }

  return res.status(out.ok ? 200 : 502).json(out)
}
