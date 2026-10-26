# Execution Roadmap: k6 Load Testing → Problems Report → Resolution → MiroFish

**Status:** 📋 PLAN ONLY — nothing installed, executed, or changed (see §8 Environment Facts)
**Date:** 2026-10-08
**Sequence (mandatory order):**

```
PHASE 1: Grafana k6 load testing (all scenarios)
   ↓ gate: runs complete, artifacts collected
PHASE 2: Detailed problems & challenges report
   ↓ gate: every finding classified + reproducible
PHASE 3: Resolve EVERYTHING (fix → re-verify → regression)
   ↓ gate: k6 green at thresholds + 115 unit tests + E2E + browser check all pass
PHASE 4: MiroFish (personas first, then market simulation)
```

Companion documents: `docs/SimulatedUsers_Plan.md` (full option catalog from the feasibility study —this roadmap is the approved execution order drawn from it, Options F → findings → Option C/D).

---

## PHASE 1 — Grafana k6 load testing

### 1.0 Environment preparation

| Step | Action | Notes |
|------|--------|-------|
| 1 | `winget install k6` | k6 **not currently installed**; winget confirmed available |
| 2 | `npx hardhat compile` | baseline, 7 files |
| 3 | `npx hardhat node` (terminal A) | fresh chain; capture `hardhat-node.log` |
| 4 | `npx hardhat run scripts/deploy.js --network localhost` (terminal B) | 6 contracts, role wiring |
| 5 | Port preflight | assert :8545 free-but-ours, :3000 free (MiroFish/dev-server collision rule from §10 of the study applies later) |
| 6 | Create `loadtest/` directory | k6 scripts + output; **new directory, no existing files touched** |

**Accounts:** use Hardhat's 20 unlocked default accounts. Unlocked status lets k6 send
`eth_sendTransaction` **without in-script signing** (k6 has no secp256k1/RLP). Pre-signed
`eth_sendRawTransaction` batches are the optional realism upgrade (§1.4 scenario R6).

### 1.1 Test suite — RPC/API level (core of Phase 1)

All scripts are plain JS against `http://127.0.0.1:8545` using the app's own ABI encoding rules
(`frontend/src/utils/contracts.js` as the single source of truth for addresses/ABIs — **never
re-derive them**).

| ID | Scenario | VUs / duration | What it stresses | Primary metrics |
|----|----------|----------------|------------------|-----------------|
| **R1** | **Read storm** — `eth_call` mix: `totalSupply`, `getBatchInfo`, listings, stake/pool reads | 25 VUs × 60 s, ramp 0→25 in 30 s | RPC read path, panel data-refresh storms | `http_req_duration{scenario:read}` p95, req/s |
| **R2** | **Write storm** — mixed `mintBatch` / `createListing` / `buy` from 10 accounts | 10 VUs × 90 s | automine queue, gas contention, nonce management | tx success rate, revert rate, p95 send latency |
| **R3** | **Full-journey mixed load** — R1 + R2 simultaneously (k6 scenarios in one script) | combined × 2 min | realistic contention | all of the above + error rate |
| **R4** | **Race: two buyers, one listing** — simultaneous `buy` on same listing, 20 iterations | burst VUs=2 | double-spend guard UX: who errors, how, does the loser get a clear revert | success/collision counts, revert reasons |
| **R5** | **Nonce contention** — same account driven by parallel VUs (deliberately triggers the known ethers v6 `eth_getTransactionCount` ~250 ms cache trap) | 5 VUs × 1 account × 60 s | the documented nonce bug in client code paths | `nonce too low` error frequency |
| **R6** | **Sustained soak** — low-rate realistic journeys (m→list→buy→retire) for 10 min | 5 VUs × 10 min | memory creep on node, cumulative state bugs, gas ledger drift | error rate over time, heap |
| **R7** | **Ramp curve** — 0→50 VUs in 5 min, mixed R1+R2 | 0→50 | breaking point of the local stack | where p95/thresholds break |

**Thresholds (initial — refine after a baseline run, then freeze):**

```js
export const options = {
  thresholds: {
    http_req_failed: ['rate<0.01'],        // <1% failed RPC calls
    http_req_duration: ['p(95)<250'],      // local node: 250 ms p95 budget
    // per scenario tags added per script
  },
};
```

### 1.2 Test suite — UI level (secondary, verify feasibility first)

k6's Playwright-based `browser` module could multiply browser VUs, **but** our harness's core trick —
injecting `window.ethereum` *before* app scripts (`evaluateOnNewDocument`) — has no known k6-browser
equivalent.

| Step | Action | Gate |
|------|--------|------|
| U1 | Spike: can k6 browser inject an EIP-1193 provider pre-load? (check `page.evaluate` / init-script support in current k6 docs) | if **yes** → write 1–2 browser scenarios (connect + read storm on the real UI); if **no** → **UI-level load stays on the existing puppeteer-core harness** (`browser-check.mjs` shim), k6 stays RPC-only |
| U2 | Decision recorded in the Phase 2 report regardless of outcome | no code changes to the app for this |

### 1.3 Artifacts produced (inputs to Phase 2)

- `loadtest/results/*.json` — k6 summary (`k6 run --summary-export`) per scenario
- `loadtest/results/*.log` — full run output with failure samples
- `hardhat-node.log` — node-side view of the same window
- Screenshots on any UI-level run; `chain-state.json` before/after each scenario (supply, listings, pools)

### 1.4 What counts as a "problem" (detection → finding)

Auto-flag anything matching: threshold breach · revert with unexpected reason · `nonce too low` ·
connection reset · success rate < 100% on race scenarios · state invariant broken after run
(`Σ batchSupply == totalSupply`, pool denominators, no listing priced at 0) · node memory growth ·
any scenario needing manual intervention to complete.

---

## PHASE 2 — Detailed problems & challenges report

**Output:** `docs/LoadTest_Report.md` (new file) with this structure:

1. **Executive summary** — runs matrix (scenario × pass/fail vs thresholds), headline numbers
2. **Baseline metrics table** — p50/p95/p99, req/s, tx success %, per scenario
3. **Findings** — one section per problem:

   ```
   ## P-<n>: <title>
   - Severity:   S1 blocker | S2 major | S3 minor | S4 cosmetic
   - Category:   performance | correctness | race/nonce | UX/error-message |
                 state-invariant | tooling/infra
   - Detected by: scenario R<x> (run link/artifact ref)
   - Evidence:    metric excerpt / revert reason / node log line
   - Repro:       exact k6 command + seed state
   - Root cause:  (hypothesis at this stage)
   - Impact:      what a real user experiences
   - Proposed fix + estimated effort
   ```

4. **Challenges** (distinct from bugs — obstacles in *doing* the testing): e.g. k6 cannot sign
   transactions natively · Hardhat automine makes timing optimistic · 20-account ceiling · ethers v6
   nonce cache · injected-provider incompatibility (if U1 fails) · Node v24 warning
5. **Classification pass** — every finding marked `fix-now` (Phase 3) vs `defer/document`
   (with justification — nothing silently dropped)
6. **Exit criteria:** every finding has severity, repro, and a disposition; the report exists.

**Rule:** Phase 2 is a *reporting* phase — no fixes are written yet (findings must be recorded
against the code state that produced them).

---

## PHASE 3 — Resolve everything

Per finding, in severity order:

| Step | Action |
|------|--------|
| 3.1 | Reproduce standalone (the repro from the report must fail on unfixed code) |
| 3.2 | Fix cause in source (contracts / frontend / harness — whatever the finding points at; **no suppressions, no weakened thresholds to "pass"**) |
| 3.3 | **Re-run the originating k6 scenario** — must now meet thresholds / succeed |
| 3.4 | **Full regression battery** after each fix batch: `npx hardhat compile` · `npx hardhat test` (115 baseline — any new failure is a Phase-3 finding too) · `node frontend/scripts/verify-integration.mjs` (25) · `node frontend/scripts/browser-check.mjs` (13) · `npm run build` |
| 3.5 | Update `docs/LoadTest_Report.md` finding → **RESOLVED** with fix commit + re-run evidence |

**If a fix changes behavior** (not just performance): add a regression unit test alongside it, per
repo convention (`test/`).

**Exit criteria (the gate to MiroFish — all must be green):**

- [ ] k6 full suite (R1–R7) green at frozen thresholds
- [ ] 115+ unit tests pass (count may grow; never shrink)
- [ ] verify-integration 25/25, browser-check 13/13, frontend build success
- [ ] Every Phase-2 finding = RESOLVED or explicitly `deferred` with written justification in `LoadTest_Report.md`
- [ ] `PROGRESS.md` updated (new verification rows + any changed known-limitations)

---

## PHASE 4 — MiroFish (only after Phase 3 gate)

Order within Phase 4 (mirrors the feasibility study):

| Step | Action | Depends |
|------|--------|---------|
| 4.1 | **Extract personas only** (preferred first step): port the `oasis_profile_generator.py` schema/prompts (`name, bio, age, mbti, profession, country, interested_topics`) to generate `persona-library.json` — needs only an LLM key, **avoids running the whole platform and its port-3000 conflict** | LLM API key |
| 4.2 | **Personas → harness**: map personas onto the multi-persona browser harness (Option C) so journeys become heterogeneous | 4.1 + harness (post-Phase-3) |
| 4.3 | **Full MiroFish run** (optional): `git clone` → `.env` with `LLM_API_KEY` + `ZEP_API_KEY` → `npm run setup:all` → **change frontend port off 3000** → seed material = carbon-market reports + `docs/DA1_Report.md` + `DA2_Report.md` → run <40 rounds first → export ReportAgent output as `docs/MiroFish_Market_Report.md` | keys, budget |
| 4.4 | Fold ecosystem findings (incentive gaming, adoption scenarios) into `PROGRESS.md` limitations/roadmap | 4.3 |

**Explicitly out of scope:** Option E (forking MiroFish for on-chain agents) — deferred, per the
feasibility study.

---

## Effort & order summary

| Phase | Content | Est. | New deps |
|-------|---------|------|----------|
| 1 | k6 install + 7 RPC scenarios + UI spike | 1–1.5 d | `k6` (winget) only |
| 2 | `docs/LoadTest_Report.md` | ½ d | none |
| 3 | Fixes + full regression | 1–3 d (unknown until findings) | none |
| 4 | Personas → optional full MiroFish | 1–2 d + tokens | LLM key; Zep key for 4.3 |

---

## Risks / constraints (carried from study §10)

1. **Hardhat automine** = optimistic latency; conclusions apply to *this stack*, not public networks.
2. **20-account ceiling** — raise only with explicit sign-off (`hardhat.config.js` change).
3. **No threshold-shopping** — thresholds frozen *before* judging results; a fix that "passes" only by
   loosening a threshold is rejected in review (Phase 3 rule).
4. **Node v24 warning** — record any k6/Node interaction issues in Phase 2 challenges.
5. **MiroFish costs** — token spend capped (start <40 rounds per their docs); port-3000 collision
   handled before 4.3 runs.
6. **Pre-existing local edits** (`App.jsx`, panels, `diagnostics.js`, `ErrorBanner.jsx` etc. are
   currently modified in the working tree) — Phase 3 fixes must not clobber them; coordinate before
   editing those files.

---

## §8 Environment facts (verified at writing)

- k6: **not installed**; `winget` available at `/c/Users/SHIVESH KUMAR/AppData/Local/Microsoft/WindowsApps/winget`
- Node v24.18.0 (repo warns Node 20 LTS is supported target — note any anomalies)
- Baselines to preserve: 115 unit tests · 25 E2E assertions · 13 browser assertions · 6 contracts
- Working tree: report docs + user's uncommitted frontend edits present; **no files modified by this plan**
