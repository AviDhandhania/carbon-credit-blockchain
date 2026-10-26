# Simulated-User Experimentation — Feasibility Study & Plan

**Status:** 📋 PLAN ONLY — nothing implemented, no code changed (see §12 Revert Log)
**Date:** 2026-10-08
**Question asked:** Can [MiroFish](https://github.com/666ghj/MiroFish) be used to simulate real users in this application, to gather real data, experiment data, and the problems users face?

---

## 1. Executive summary

**Short answer: MiroFish cannot drive this application.** It is a swarm-intelligence *prediction*
engine that simulates agents inside its own Twitter/Reddit-style parallel world — its action space is
social posts/replies/follows, hard-coded to two platforms (`platform: str  # twitter or reddit` in
`simulation_config_generator.py`; runners are `run_twitter_simulation.py` / `run_reddit_simulation.py`
/ `run_parallel_simulation.py`). There is **zero browser automation** in it (no playwright, puppeteer,
or selenium anywhere in backend or frontend). Its agents cannot connect a wallet, click the React UI,
or send a transaction to the six contracts.

**However, three parts of the overall goal are achievable**, and MiroFish is useful for two of them:

| Goal | Verdict |
|------|---------|
| Problems being faced (UX bugs, broken flows, confusing states) | ✅ **Yes** — via an in-app multi-persona browser harness built on this repo's existing `browser-check.mjs` (recommended primary approach) |
| Real / experiment data about *this app* (tx metrics, flow success rates, traces) | ✅ **Yes** — same harness, plus load & fault-injection experiments |
| Realistic user personas | ✅ **Yes** — reuse MiroFish's persona generator (`oasis_profile_generator.py`) or generate equivalent personas with an LLM |
| Experiment data about the *ecosystem* (adoption, market sentiment, gaming scenarios) | ✅ **Yes** — run MiroFish as intended, seeded with carbon-credit market material + this repo's mechanism docs |
| Making MiroFish agents transact on-chain (fork approach) | ⚠️ **Doable but expensive** — custom OASIS platform + ethers bridge; detailed in §8 |

**Recommended path:** Phased plan in §9 — persona library (MiroFish-style) → scripted multi-wallet
harness → optional LLM-driven exploratory users → market/load/fault experiments.

---

## 2. What "real data / experiment data / problems" means here (acceptance targets)

The report should eventually deliver these artifacts:

1. **`traces.jsonl`** — one event per user action: `{session, persona, ts, journey, step, action, target, status, error?, txHash?, gas?, domScreenshot?}`.
2. **`metrics.json`** — aggregates: per-flow success/failure rate, time-to-complete per journey, gas per action class, RPC latency, nonce-conflict count, console-error count.
3. **`problems.md`** — ranked list of problems found, each with: reproduction steps (trace refs), severity, screenshot, expected vs actual.
4. **`chain-state.json`** — before/after on-chain snapshot (supply, listings, stakes, pools, roles) proving what the simulated population actually did.
5. **`market-report.md`** (optional, MiroFish output) — ecosystem-level prediction report.

Problem taxonomy we will deliberately hunt for (from what the repo's history shows bugs hide):

- **Stale-closure / data-binding bugs** (already caught once: four panels no-oped their first `loadData()`)
- **Silent failures** — tx rejected but UI shows no message; `ErrorBanner` not triggered
- **Race conditions** — two personas acting on the same batch/listing; nonce reuse (known ethers v6 250 ms `eth_getTransactionCount` cache issue documented in `verify-integration.mjs`)
- **Empty/first-run states** — panels before any mint, before connect, wrong network badge
- **Boundary values** — zero-amount buys, splitting more than batch supply, window bounds (1–365 days), claiming compensation twice
- **Role/permission UX** — non-regulator trying multisig actions, non-minter calling `mintBatch`
- **MetaMask-specific UX** — *out of reach* of the injected-provider approach (documented limitation #5 in `PROGRESS.md`); real-wallet testing remains manual

---

## 3. Asset inventory (what already exists in this repo)

| Asset | Location | Reuse value |
|-------|----------|-------------|
| Browser harness: loads real dev server in headless Chrome, injects a minimal EIP-1193 provider, runs the app's **real** connect path, asserts DOM, screenshots | `frontend/scripts/browser-check.mjs` (13 assertions, puppeteer-core) | **Core seed** for the multi-persona simulator — injection snippet, Chrome discovery, check() pattern, screenshot capture all reusable |
| Live-chain E2E through frontend ABIs (25 assertions), incl. nonce-tracking workaround | `frontend/scripts/verify-integration.mjs` | Journey sequencing + state assertions reusable as "did the world actually change" checks |
| Unit suite, 115 passing | `test/*.test.js` | Baseline of correct behavior; new problems found by simulation must not duplicate these |
| 6 contracts wired with roles, 3-of-5 multisig, optional MRV oracle | `contracts/`, `scripts/deploy.js` | The full state machine the simulated population can drive |
| UI action surface (per component) | `CreditTokenPanel`: `mintBatch`, `splitBatch` · `MarketplacePanel`: `approve`, `createListing`, `cancelListing`, buy · `RetireCertifyPanel`: `approve`, `retireAndCertify` · `VerifierStakePanel`: `stake`, `createChallenge`, `resolveChallenge`, `claimCompensation`, `setBatchChallengeWindow` · `RegulatorMultisigPanel`: `proposeResolution`, `approveResolution` · `WalletConnect`, `ErrorBanner` | Enumerates the complete set of user actions to simulate |
| 20 funded Hardhat accounts | hardhat defaults; 3 already used by verify-integration (deployer + 2), owners 0–4 back the multisig | Wallet pool for N concurrent personas (see constraint §11) |
| Deps already present | `ethers ^6.9.0`, `puppeteer-core ^25.12.0` (root `package.json`) | Phases 1–2 need **no new dependencies** |

---

## 4. Option catalog — every way found to simulate users/data

### Option A — Scripted multi-persona in-app harness ⭐ (primary)

Extend `browser-check.mjs` into `frontend/scripts/simulate-users.mjs`:

- Spawn N headless Chrome contexts, each injecting a **different** Hardhat key through the existing
  EIP-1193 shim (the shim already parameterizes the account; multi-account needs one more method —
  `wallet_switchEthereumChain` and per-context `eth_requestAccounts` handling).
- Each persona runs a **journey script** (JSON): e.g. *Developer* mints 2 batches + splits one;
  *Verifier* stakes and later challenges; *Buyer* approves → lists → buys → retires → claims
  compensation; *Regulator* runs propose → 3 approvals across 3 owner sessions.
- Journey steps are plain DOM interactions (find button by label, fill input, wait for state) —
  no MetaMask, no LLM, fully deterministic, CI-runnable.
- Every step emits a trace event; failures are captured with screenshot + console log + tx revert reason.

**Gives:** problems faced (taxonomy §2), traces, success rates, gas/timing metrics.
**Cost:** low — existing deps only, 1–2 days of work.
**Limits:** scripted personas won't discover *unscripted* weirdness; MetaMask UX out of reach.

### Option B — LLM-driven exploratory users (autonomous clicking) ⭐ (phase 3, optional)

Instead of fixed scripts, give an agent loop a persona goal ("you're a skeptical buyer who wants to
retire credits but distrusts batch 2") and let it decide each step from an accessibility/DOM snapshot:

- **In-repo approach (no new framework):** small loop over the same puppeteer-core shim:
  snapshot DOM → send to OpenAI-format LLM (repo already has no LLM dep; would add one) → parse
  action → click/fill → observe → repeat until goal or budget exhausted. ~150 lines.
- **Off-the-shelf alternatives** (verify current state at implementation time):
  - **browser-use** — agent loop framework; bring-your-own browser, pairs with CDP.
  - **Playwright MCP** (`@playwright/mcp`) — ~25 structured browser tools; you supply the agent loop.
  - **Stagehand** — hybrid deterministic/LLM actions.
  - Academic precedent exists for exactly this: **UXAgent** (LLM-agent usability testing of web
    designs) and other LLM user-simulator toolkits (2025–2026 literature).
- **Key advantage:** a persona with a *goal* rather than a script can hit states nobody scripted —
  that's where the interesting "problems being faced" come from.
- **Cost:** needs an LLM API key; token spend per session; nondeterministic → keep the scripted
  layer (Option A) as the regression baseline.

### Option C — MiroFish personas → app harness (user-selected)

MiroFish's `backend/app/services/oasis_profile_generator.py` produces rich profiles with fields:
`name, bio, age, gender, mbti, country, profession, interested_topics` (entity types: student,
expert, organization, etc.), generated by LLM from a knowledge graph built from your seed material.

**Two reuse modes:**

1. **Run MiroFish once** with seed material = carbon-credit market background + `docs/DA1_Report.md` +
   `docs/DA2_Report.md`; harvest the generated profiles (JSON) as the persona library.
2. **Extract just the generator** — the persona prompt/schema logic is ~1.2k lines and mostly
   self-contained; port the schema + prompt to a small script (avoids running the whole platform).

Each persona then maps to a harness session:

```json
{
  "persona": { "name": "…", "profession": "verifier", "mbti": "ISTJ", "interested_topics": ["MRV"] },
  "wallet": 5,
  "journey": "verifier-stake-challenge",
  "riskTolerance": 0.3,
  "budget": { "maxTx": 8, "maxEth": 2.0 }
}
```

Personas influence: which journey, how many steps, retry/abort propensity, amounts staked, whether
they attempt "risky" paths (flagged batch, double claim) — producing **heterogeneous, plausible
population behavior** instead of N identical scripts.

**Cost:** low–medium; requires running MiroFish (or extracting it) — needs `LLM_API_KEY` +
`ZEP_API_KEY` if run as a platform (persona generation itself only needs the LLM key).
**Port note:** MiroFish's frontend binds **port 3000, same as this app's dev server** — run it
changed, or only use the extracted generator.

### Option D — MiroFish market/ecosystem simulation (run as intended)

Feed MiroFish seed materials (carbon-market reports, policy news, your mechanism docs) and let its
agent population social-evolve on its simulated platforms; use its **ReportAgent** to produce a
prediction report.

**Gives genuinely useful "experiment data," just at a different level:**
- Will a rational verifier ever stake 1 ETH given challenge risk? What breaks the incentive design?
- How does policy news shift buyer willingness / secondary listing prices?
- How fast does a scandal about a fraudulent batch propagate → does the challenge mechanism get used?
- Policy rehearsal: what if the challenge window were 30 days instead of 90?

**Not:** telemetry about your UI, on-chain numbers, or bug discovery.
**Cost:** LLM tokens (their docs: start <40 rounds; thousands of agents get expensive fast — a
community discussion exists about cost reduction via cheaper inference providers), Zep Cloud free tier.

### Option E — Fork MiroFish with a custom platform bound to the contracts (unselected, assessed)

**Doable in principle:** OASIS (the engine under MiroFish) is built on simulated platforms with
action spaces; you could define a platform whose actions are `mintBatch/createListing/buy/...`
executed through ethers against localhost. Agent "decisions" from Option D then land on your chain.

**Effort assessment:** high. Requires (a) forking MiroFish's ~12.5k-line Python backend *and*
running the OASIS env with a new platform type; (b) a Python↔JSON-RPC bridge with per-agent funded
accounts (20 Hardhat accounts cap concurrency, or raise `accounts` in `hardhat.config.js`);
(c) mapping MiroFish's social action schema to 15 contract methods; (d) debugging a codebase where
the platform enum is baked into config, IPC, stats, and both runners.

**Verdict:** combines D's realistic decision-making with on-chain data, but it is a multi-day-to-week
integration against someone else's framework. **Recommend deferring** — Option A+B on this repo
reaches 90% of the value in 10% of the effort, and Option D already delivers the ecosystem
experiment data without any fork.

### Option F — Load / concurrency experiments

Generate realistic concurrent activity without a browser: N ethers wallets firing overlapping
journey transactions at the local node (scripted from the same journey definitions as Option A).

- Reveals: nonce collisions (the known ethers v6 cache trap), RPC backlog, gas-price contention,
  UI behavior while txs are pending, panel refresh storms.
- Tools: plain `ethers` fan-out (no dep), or **k6**/**artillery** for pure JSON-RPC HTTP load
  (extra tooling; only worth it if RPC-level load itself becomes the question).
- Caveat: Hardhat's automining makes this optimistic vs. real networks; still valid for *this app's*
  client-side handling.

### Option G — Fault injection / hostile environment

Same harness, deliberately break the world mid-journey: kill the RPC between click and confirmation,
return revert reasons, switch chainId, expire allowance, flag a batch while a buy is in flight,
submit a challenge one second after the window closes.

**Gives:** error-handling problems — precisely the "problems being faced" class that happy-path
tests (existing 115 tests + 25 assertions) systematically miss.

### Option H — Adversarial/stateful contract fuzzing (complement, not UI)

Tools like Echidna/Medusa or hardhat property tests to hunt economic exploits (double-claim
compensation, split-then-challenge laundering, listing after flag). The repo's history shows this
works — §2.6 of `PROGRESS.md` documents a real bug found (`_retireBatch` never set `isRetired`).
**Out of the "simulate users" scope proper**, but worth listing as a data source for "problems".

### Option I — Telemetry capture during simulation

Every simulated session already produces traces; add a dev-only funnel in the app? **Not
recommended** — instrumentation would touch app code and risk measuring the observer. Prefer
purely external observation (DOM mutation log via puppeteer, network log, chain log) which keeps
the app unmodified.

---

## 5. Comparison matrix

| Option | Finds UI problems | On-chain experiment data | Ecosystem/prediction data | New deps/keys | Effort | Recommended |
|--------|:-:|:-:|:-:|----------------|--------|-------------|
| **A** Scripted multi-persona harness | ✅ | ✅ | ❌ | none | 1–2 d | ⭐ Phase 2 |
| **B** LLM exploratory users | ✅✅ | ✅ | ❌ | LLM key | 1 d + tokens | ⭐ Phase 3 (optional) |
| **C** MiroFish personas → harness | ➖ (raises realism) | ➖ | ❌ | LLM key (MiroFish run) | 0.5–1 d | ⭐ Phase 1 |
| **D** MiroFish market simulation | ❌ | ❌ | ✅ | LLM + Zep keys | 0.5 d + tokens | ⭐ Phase 4 (optional) |
| **E** Fork MiroFish → custom platform | ➖ | ✅ | ✅ | LLM + Zep keys | multi-week | ❌ Defer |
| **F** Load/concurrency | ✅ (races) | ✅ | ❌ | none (or k6) | 0.5 d | Phase 4 |
| **G** Fault injection | ✅✅ (error paths) | ✅ | ❌ | none | 0.5–1 d | Phase 4 |
| **H** Contract fuzzing | ❌ | ✅ | ❌ | tooling | days | Backlog |
| **I** In-app telemetry | ➖ | ➖ | ❌ | app changes | — | ❌ Rejected |

---

## 6. Architecture of the recommended solution (plan only)

```
persona-library.json ──┐ (Phase 1: MiroFish generator or LLM, schema §4C)
                       ▼
        ┌──────── simulate-users.mjs ────────┐   (Phase 2, frontend/scripts/)
        │  orchestrator: fresh deploy →      │
        │  N sessions (one Chrome context    │
        │  + one injected EIP-1193 key each) │
        │  journey runner (JSON steps)       │
        │  event bus → traces.jsonl          │
        │  failure → screenshot + DOM dump   │
        └────────┬──────────────┬────────────┘
                 ▼              ▼
        dev server :3000   hardhat node :8545 + deploy.js
                 │
                 ▼ (Phase 3, optional)
        LLM goal-runner: persona goal → DOM snapshot → action
```

- **Determinism layer (A)** = regression baseline, runs in CI.
- **Exploration layer (B)** = problem discovery, run on demand with a token budget.
- **Experiments (F/G)** = same orchestrator with a scenario flag.

**Journey library (initial set, all UI-driven):**
`developer-mint-split` · `verifier-stake-challenge-window` · `buyer-list-buy-retire-certify` ·
`compensation-claim-after-slash` · `regulator-3of5-resolution` · `negative-permissions` ·
`negative-boundaries` · `race-two-buyers-one-listing`.

---

## 7. What each experiment yields (mapping back to the original ask)

| Ask | Source |
|-----|--------|
| **real data** | Traces + metrics from real app code on a real chain: what a connected session actually does, how long, at what gas, with what errors |
| **experiment data** | (a) In-app: success rates, race/fault outcomes, load curves; (b) ecosystem: MiroFish prediction report (Option D) |
| **problems being faced** | `problems.md` from failures, silent errors, console/page errors, boundary and permission journeys, plus LLM exploratory sessions' dead ends |

---

## 8. MiroFish-specific findings (research record)

- Repo cloned shallow to temp for inspection; **removed afterwards** (§12).
- Architecture: Python ≥3.11 backend (`backend/app/services/*`, ~12.5k lines), React frontend,
  `camel-oasis==0.2.5`, Zep Cloud memory, OpenAI-format LLM API (default Qwen-plus via DashScope).
- Workflow: seed → GraphRAG graph → entity/persona generation → dual-platform (Twitter/Reddit)
  simulation → ReportAgent → deep chat with any simulated agent.
- **Hard constraints for our use case:** platform enum = twitter/reddit only; no browser/HTTP tool
  for agents to reach external apps; no wallet/chain concept anywhere in the codebase.
- **Persona field set** (reusable): `name, bio, age, gender, mbti, country, profession,
  interested_topics` + entity types (student/expert/organization/news) — good raw material for
  harness personas (Option C).
- **Ops notes:** ports 3000/5001 (collides with this app's dev server on 3000 — change port when
  running side by side); `npm run setup:all`, `npm run dev`; Docker option available; token cost
  scales with agent count × rounds (community discussion on cheaper inference exists).

---

## 9. Recommended plan (phases — not started)

| Phase | Deliverable | Depends on | Est. |
|-------|-------------|------------|------|
| **0. Experiment scaffold** | `scripts/` orchestrator: fresh node → deploy → dev server → snapshot; fixed run directory; port check (catch MiroFish/dev-server collision) | nothing | ½ d |
| **1. Persona library** | Run MiroFish persona generator (or LLM equivalent) → `persona-library.json` with schema §4C; 10–20 personas across the 4 roles | MiroFish **or** an LLM key | ½–1 d |
| **2. Scripted multi-user harness** (Option A) | `simulate-users.mjs`: N sessions, journey library, traces/metrics/problems artifacts | Phase 0–1 | 1–2 d |
| **3. LLM exploratory users** (Option B) | Goal-driven agent loop on the same shim; token budget + session cap; auto-dedupe into `problems.md` | LLM key | 1 d |
| **4. Experiments** (D/F/G) | Market prediction report (MiroFish, new port) · load curve · fault-injection scenario pack | Phase 2 (+ keys for D) | 1–2 d |
| **5. Findings writeup** | `problems.md` + `metrics.json` + charts; update `PROGRESS.md` | all | ½ d |
| — Deferred | Option E (fork), Option H (fuzzing) | explicit go/no-go | — |

**Quick win if only one thing is approved:** Phase 0 + 2 — the scripted harness already yields
problems, traces, and metrics with zero new dependencies.

---

## 10. Risks & constraints

1. **MetaMask UX remains untested** — injected EIP-1193 bypasses popup approval, network-switch
   prompts, and extension errors (existing known limitation #5). Real-wallet sessions stay manual.
2. **20-account ceiling** on default Hardhat — either cap concurrency or raise `accounts` in
   `hardhat.config.js` (a config change needing sign-off).
3. **LLM costs/nondeterminism** for Phases 1/3/4-D — cap rounds/sessions; keep Phase 2 deterministic.
4. **Port collisions** — this app :3000, MiroFish frontend :3000, backend :5001. The scaffold must
   assert ports before runs.
5. **Automined chain ≠ real network** — timings/gas contention are optimistic; Sepolia would be the
   realistic (and irreversible/costly) tier, not part of this plan.
6. **Simulated ≠ real users** — traces are synthetic behavioral data; fine for design decisions and
   bug discovery, not for claiming real-world adoption metrics.
7. **"Real data" ethics/scope** — all experimentation runs against local simulated accounts and
   local/mock oracles; no real user data is involved, nothing touches public networks.

---

## 11. Open decisions (to confirm before any implementation)

1. Approve which phases? (Minimum viable: 0 + 2.)
2. Persona source: run full MiroFish, extract only its generator, or plain LLM generation?
3. LLM provider/key available for Phases 1/3/4-D (OpenAI-compatible endpoint required)?
4. Raise Hardhat account count for larger populations?
5. Is Option E (fork) worth revisiting after Phase 2 results?

---

## 12. Revert log (actions taken during this research — all reverted)

| Action | State |
|--------|-------|
| Shallow-cloned MiroFish to OS temp dir for source inspection | **Removed** after report written; nothing added to this repo |
| Web research (MiroFish docs, browser-agent landscape, LLM user-simulator literature) | Read-only |
| Greps/reads of this repo | Read-only |
| Repo changes | **Only this file** (`docs/SimulatedUsers_Plan.md`); no code, config, or dependency changes |
