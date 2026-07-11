---
name: verify
description: Run The Complete Machine's full verification pipeline (engine determinism + purity + book sanity + build + headless-browser render check). Use before every commit, after any engine/App/style change, or when asked to check that the app still works.
---

# Verify — the mandatory pre-commit pipeline

One command runs everything:

```bash
node scripts/verify.mjs
```

Flags: `--skip-build` (engine checks only), `--skip-browser` (engine + build).
Exit code 0 = every quality bar in CLAUDE.md holds. Non-zero prints a FAIL list.

## What it checks (and why each check exists)

| Check | Failure it catches (all have happened) |
|---|---|
| Engine modules import in bare Node | React/DOM/localStorage leaked into `src/engine` |
| Backtest / risk / screen run twice → identical JSON | Nondeterminism, reordered rng draws |
| Season risk shares equal (25/25/25/25) | Risk-parity collapse from hedge assets (the ERC bug) |
| Credit book non-empty, sums ~100, cap ≤ 22 | "The dead credit desk" — gates that reject everything |
| Docket conviction === unified grade | Formula re-implemented at a second call site |
| Routine OMS rebalance → zero vetoes | Caps enforced by veto instead of clipped at planning |
| Disclaimers ≥ 2 | Weakened Charter language |
| `npm run build` exits 0 | Syntax/import errors |
| Headless: 13 sections, markers, zero errors | **"The bundle-order crash"** — build green, page dead |
| Click Rebalance → positions appear | The paper book's full interactive path |

## Interpreting failures

- **`sections === 13` fails after you intentionally added a section** → update
  `SECTION_COUNT` in `scripts/verify.mjs` AND the count in CLAUDE.md, same commit.
- **Console errors mentioning `ERR_TUNNEL` / `Failed to load resource`** are
  already excluded — they're the Wikimedia art plates, blocked in sandboxes by
  network policy; the gallery withdraws them gracefully. Any *other* console
  error is real. `Cannot access 'X' before initialization` = a `useMemo`/const
  in `App.jsx` declared below its first reference — move the declaration up.
- **Marker missing** → check case first (markers are compared lowercased
  because `.lbl` uppercases via CSS and `innerText` reflects it), then check
  whether you renamed on-screen text without updating `MARKERS`.
- **Determinism fails** → you inserted/removed/reordered an rng draw inside an
  existing loop. New randomness must use its own `mulberry32(seed)`.
- **Browser step hangs** → Chromium lives at `/opt/pw-browsers/chromium`;
  never run `playwright install`.

## After it passes

Commit (message says what + why), then push to the working branch **and** main:

```bash
git push origin <branch> && git push origin <branch>:main
```

Vercel deploys `main`. Do not skip the second push.
