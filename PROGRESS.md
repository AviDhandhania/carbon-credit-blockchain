# Project Progress

Single source of truth for what is built, what is verified, and what is deliberately out of scope.

**Last updated:** 2026-10-22
**Status:** DA1 complete · DA2 complete · DA3 complete (all in-repo roadmap items) · load testing done (k6), findings open · research-paper experiment suite run and reported

---

## 1. Headline status

| Phase | Scope | Status |
|-------|-------|--------|
| **DA1** | Design report, presentation, diagrams | ✅ Complete |
| **DA2** | 4 core contracts, tests, React frontend, deploy script | ✅ Complete |
| **DA3** | Roadmap features from `DA2_Report.md` §4 | ✅ Complete |

### Verified evidence

| Check | Command | Result |
|-------|---------|--------|
| Unit suite | `npx hardhat test` | **115 passing, 0 failing** (exit 0) |
| Contract compile | `npx hardhat compile` | 7 Solidity files, 0 errors |
| Local deploy | `npx hardhat run scripts/deploy.js --network localhost` | 6 contracts, exit 0 |
| End-to-end (live chain, frontend ABIs) | `cd frontend && node scripts/verify-integration.mjs` | **25 passed, 0 failed** (exit 0) |
| Browser render (headless Chrome, real app) | `cd frontend && node scripts/browser-check.mjs` | **13 passed, 0 failed** (exit 0) |
| Frontend build | `cd frontend && npm run build` | success, exit 0 |
| Load test suite (Grafana k6, 7 scenarios) | `bash loadtest/run-all.sh` | **7 of 8 runs green**; R7 ramp fails its p95 budget → see `docs/LoadTest_Report.md` |
| Load regression re-check (after harness fixes) | `npx hardhat test` · `verify-integration.mjs` · `browser-check.mjs` · `npm run build` | 115 · 25 · 13 · build OK |
| Research-paper experiment suite (44 runs) | `bash loadtest/run-experiments.sh` → `node loadtest/report/stats.mjs` → `python loadtest/report/make-graphs.py` → `node loadtest/report/build-report.mjs` | 44 runs aggregated, 12 figures and `docs/Research_Paper_Experiments.md` regenerated; two data gaps documented, not smoothed over |

Test count history: the DA2 report and `AGENTS.md` disagreed (`36` vs `44`); both were stale. The
suite is now **115** tests — 50 core plus 65 covering the DA3 features. The six additions cover
batch-faithful settlement, the rejected permissionless burn, constant-time batch bookkeeping and a
retirement gas bound.

---

## 2. DA3 roadmap items

These are the seven gaps listed in `docs/DA2_Report.md` §4, now resolved or explicitly deferred.

| # | Item | Status | Where |
|---|------|--------|-------|
| 1 | Multi-sig regulator panel (3-of-5) | ✅ Done | `contracts/RegulatorMultisig.sol` |
| 2 | Configurable per-batch challenge window | ✅ Done | `VerifierStake.setBatchChallengeWindow` |
| 3 | Satellite/MRV data oracle | ✅ Done (interface + mock) | `contracts/interfaces/IMRVOracle.sol`, `contracts/MockMRVOracle.sol` |
| 4 | Batch fractionalization | ✅ Done | `CreditToken.splitBatch` |
| 5 | Per-batch compensation pools, pro-rata | ✅ Done | `VerifierStake.claimCompensation` |
| 6 | Mainnet + L2 deployment | ⛔ Blocked (needs funded keys) | see §3 |
| 7 | Fiat on/off-ramp | ⛔ Out of scope (needs a payments vendor) | see §3 |

### 2.1 Multi-sig regulator (3-of-5)

Replaces the single regulator EOA that DA2 flagged as the weakest trust assumption. The panel holds
`REGULATOR_ROLE` on `VerifierStake`; the deployer's single-key role is **revoked at deploy time**.
A resolution must be proposed once and approved by `threshold` distinct owners, and executes
automatically on the final approval. Verified by 23 unit tests plus an end-to-end run proving the
deployer alone cannot resolve.

Override the panel with `MULTISIG_OWNERS` / `MULTISIG_THRESHOLD`; set `KEEP_DEPLOYER_REGULATOR=true`
only if you deliberately want to keep single-key power (the demo convenience escape hatch).

### 2.2 Configurable challenge window

The 90-day window was hardcoded. There is now a global `defaultChallengeWindow` (still 90 days) plus a
per-batch override, bounded to 1–365 days. `getChallengeWindow(batchId)` resolves override → default,
and `createChallenge` consults it. `CHALLENGE_WINDOW` is retained as the initial default.

### 2.3 MRV oracle

`IMRVOracle` exposes `isProjectApproved`, `getProjectHash`, `getVerifiedTonnage`. `CreditToken` holds an
optional `mrvOracle`: when it is `address(0)` minting is unchanged, so this is fully backwards
compatible. Wiring it makes `mintBatch` require an approved project **and** a matching evidence hash.

> Honest limitation: `MockMRVOracle` is admin-settable, so it proves the *plumbing*, not the data.
> A production feed needs an adapter to satellite/registry sources — that is off-chain work.

### 2.4 Batch fractionalization

`splitBatch(batchId, amount, projectId)` moves part of a batch into a child batch that inherits the
parent's verifier and IPFS evidence. **No tokens are minted or burned** — total supply is invariant,
which is the point: it regroups ownership rather than diluting. Lineage is queryable via
`getBatchParent`. Flagged and fully-retired batches cannot be split, so a disputed batch cannot be
laundered into a clean-looking child.

New `batchSupply` accounting makes `Σ batchSupply == totalSupply` hold, which item 5 needs in order to
know how many holders to divide a pool between.

### 2.5 Per-batch compensation, pro-rata

Previously a successful challenge pushed the buyers' half to one `compensationPool` address — arbitrary,
and in the default deploy that address was an EOA. Now each batch gets its own pool:

- on resolution the compensation credits `batchCompensationPool[batchId]`, and
  `batchCompensationDenominator[batchId]` snapshots the batch supply;
- holders call `claimCompensation(batchId)` and receive `pool × theirBalance / denominator`;
- `compensationClaimedTokens` tracks what each address has already claimed against, so a repeat claim
  is measured only on newly acquired tokens and the pool can never be over-drawn;
- the **slashed verifier is blocked** from claiming out of the pool meant for the buyers it misled;
- a flagged batch is **transfer-frozen** (`CreditToken._update` reverts on any flagged batch being
debited), so no one can acquire a batch after a successful challenge and inflate the claimant set.

That transfer freeze is what closes the gap that was previously documented here: the denominator is a
snapshot of supply at resolution, and freezing the batch keeps live balances equal to that snapshot for
the holders who actually existed at the time. Flag/unflag is admin-only, so lifting the freeze is an
explicit, auditable act.

### 2.6 Bug found and fixed along the way

`CreditToken._retireBatch` checked `batches[batchId].isRetired` but **never set it**, so a fully retired
batch reported `isRetired == false` forever via `getBatchInfo`, and `splitBatch` could not tell a dead
batch from a live one. Now the flag is set when circulating supply reaches zero, and there is a
regression test for it.

---

## 3. Deliberately deferred

| Item | Why not done | What it needs |
|------|--------------|---------------|
| Mainnet / L2 deploy | Cannot be done responsibly without funded keys, and a public deployment is a real irreversible action | A funded wallet, RPC keys, and an explicit decision to spend real value |
| Fiat on/off-ramp | Requires a third-party payments vendor and KYC/compliance obligations | Vendor selection, business account, legal review |
| Real satellite MRV feed | Requires an off-chain data provider and credentials | Provider contract; the on-chain interface is already in place |

`hardhat.config.js` carries `localhost` and `sepolia` networks only, so item 6 is a configuration and
funding task rather than a code task.

---

## 4. Module status

| Module | Status | Notes |
|--------|--------|-------|
| `CreditToken.sol` | ✅ Done | ERC-20, batch tracking, fractionalization, optional MRV gate, flagging |
| `Marketplace.sol` | ✅ Done | Listings, purchases, price updates |
| `RetireAndCertify.sol` | ✅ Done | Burn + soulbound ERC-721 certificates |
| `VerifierStake.sol` | ✅ Done | Stakes, challenges, configurable windows, per-batch pro-rata pools |
| `RegulatorMultisig.sol` | ✅ Done | **New** — 3-of-5 threshold gate |
| `MockMRVOracle.sol` | ✅ Done | **New** — settable MRV attestation stand-in |
| `interfaces/IMRVOracle.sol` | ✅ Done | **New** — MRV oracle interface |
| Frontend | ✅ Done | Panels for all contracts including the multisig; `npm run build` passes |
| Deploy script | ✅ Done | Deploys 6 contracts, wires roles, revokes single-key regulator by default |
| Tests | ✅ Done | 115 passing |
| End-to-end check | ✅ Done | `frontend/scripts/verify-integration.mjs`, 25 assertions |
| Browser check | ✅ Done | `frontend/scripts/browser-check.mjs`, 13 assertions in headless Chrome |

---

## 3b. Load testing with Grafana k6 (2026-10-08)

New harness in `loadtest/` (k6 v2.2.0): R1 read storm, R2 write storm, R3 mixed, R4 two-buyer race,
R5 nonce contention, R6 buy→retire soak, R7 0→50 VU ramp, plus `setup-roles.js` (role provisioning),
`measure-gas.js` and a runner. Full report: [`docs/LoadTest_Report.md`](docs/LoadTest_Report.md);
plan: [`docs/K6_To_MiroFish_Roadmap.md`](docs/K6_To_MiroFish_Roadmap.md).

Headlines: ~60k requests / ~12k transactions with **0 HTTP failures, 0 RPC errors, 0 over-sells**
(R4: 10 of 12 races had exactly one winner). The local node's read path saturates between 25 and 50
concurrent actors — 278.8 req/s at p95 79.7 ms with 25 readers, **38.0 req/s at p95 3.0 s with 50**
(read-only control), which is why R7 fails its threshold. That ceiling and six further findings
(retirement is a 2-tx approve→retire flow; a seller's single allowance is shared across all their
listings; `retireAndCertify` gas grows with the holder's batch count and blew a 500 k limit in 16.8 %
of soak retires; raw RPC errors reach the UI; every role lives on the deployer) are **open** with
remediation options — nothing was hidden by loosening a threshold, and no product file was changed.

## 3c. Research-paper experiment suite (2026-10-22)

Full suite in `loadtest/` for the paper: sweep at 10/50/100/250/500/1000 concurrent users ×3 reps,
baseline comparison (`BaselineVerifier` vs staking off vs staked, ×3), staking scenarios A–D ×3,
stress ladder ×2, spike ×2 and a 30-minute endurance run ×1 — **44 runs** total. Every figure in
[`docs/Research_Paper_Experiments.md`](docs/Research_Paper_Experiments.md) is generated from
`loadtest/results/exp/` by `stats.mjs` → `make-graphs.py` → `build-report.mjs`; nothing is typed in.

Headlines (successful-request figures, not raw request counts):

- **Capacity peaks at 10 users**: 185.2 req/s, and successful throughput falls below 95 % of that by
  50 users (114.8 req/s). The curve is saturation, not scaling.
- **Success holds ≥99 % to 250 users** (99.93 %), falls to 95.9 % at 500, and collapses to 2.2 % at
  1000 — where 97.8 % of requests are rejected and the raw 3,783 req/s is a failure rate, not capacity.
- **p95 first breaches the 1 s budget at 100 users** (1,365 ms), at a level where every request still
  succeeds.
- **Stress** (ladder to 1000) ends at 14.1 % success — the expected threshold breach; **spike**
  (50→500→50) keeps 99.99 % success but p95 reaches 4,459 ms; **endurance** (100 users, 30 min) stays
  at 100 % success, 127.8 req/s, with node RSS growing 585 MB over the run (an observation, not a
  leak diagnosis).

Data-integrity fixes made while generating this report: a rep that produced no traffic in its
measurement window is now excluded rather than counted as `0 ms / 0 req/s / 100 % success`; capacity
figures use successful throughput so a fast-failing node cannot look like a peak; k6's all-zero
gas/lifecycle trends are rendered `—` instead of `0`; the stress/spike/endurance shapes use their own
run duration for throughput; blank resource samples no longer read as 0 MB; and the report now has a
stress/spike/endurance section (§7) plus derived breach statements that no longer contradict each other.

**Retirement defect found and fixed (2026-10-22).** The earlier suite recorded 0 mined retirements
because of two separate causes, both reproduced on a live chain:

1. **Gas limit below the real cost.** On the 400-batch experiment pool, `retireAndCertify` for the
   seller estimates at **2,348,600 gas**, but the sweep sent it with `GAS.standard` = **2,000,000**.
   Hardhat rejects an under-gassed send outright, so it appeared as `send_fail` with no receipt —
   which is why `mined_revert` was 0 and the gas column was empty rather than a mined revert.
2. **The retire actors did not hold the listed batch.** `Marketplace.buyTokens` performs a plain
   ERC-20 `transferFrom`; `CreditToken._update` debits the seller's **oldest** batches first, so a
   buyer does not necessarily receive the batch named by the listing. Retiring the listed batch then
   reverted with `Insufficient batch balance` for four of the five actors.

The harness now mints a dedicated 100,000-credit retirement batch to each actor during `setup()`, so
retirement is deterministic, and sends `retireAndCertify` with `GAS.heavy` (5,000,000). Verified on a
fresh chain with the 400-batch pool at 50 concurrent users: **19 retirement submissions, 19 mined, 0
rejected, 0 no-receipt**, at 342,491 gas for a single-batch holder and 2,370,578 gas for the 400-batch
holder (mean 1,483,347). One harness caveat the verification exposed: the actor mix is assigned per
virtual user, so the retire role lands only on users 21 and 42 of every hundred; the 10-user level
contains no retirement actor at all. That is now stated in the DA3 report rather than implied by the
"2 %" mix.

The current `Research_Paper_Experiments.md` still describes the old run (2,991 rejected attempts); a
fresh `bash loadtest/run-full-experiment.sh` (~3.5 h) is needed to replace that section with measured
retirement cost. The report states the gap rather than filling it with a plausible number.

**Product defects fixed after the harness diagnosis (2026-10-22).** Both contract defects found during
the load work are now fixed in the product, with regression tests:

- **Batch-faithful settlement.** `CreditToken.transferBatchFrom(from, to, batchId, amount)` is
  restricted to `BATCH_TRANSFER_ROLE`, which the deploy script grants to the Marketplace, and moves
  exactly the named batch while still consuming the seller's allowance. `Marketplace.buyTokens` uses
  it, so a seller holding several batches can no longer deliver a different batch from the one the
  listing named. Test: a two-batch seller lists the newer batch and the buyer receives that batch
  and none of the older one.
- **Constant-time retirement.** `_retireBatch` no longer re-sums the holder's batch list. Batch lists
  are maintained through a 1-based index map (`_batchIndex`) plus `activeBatchCount`, so adding and
  removing a batch is O(1). The 400-batch pool that used to cost 2,348,600 gas retires for about
  370 k. Test: a 30-batch holder retires within 30 k gas of a one-batch holder.
- The inherited `burn`/`burnFrom` now revert, because a burn outside `_retireBatch` would bypass batch
  accounting; retirement is the only terminal state.

The deploy script grants `BATCH_TRANSFER_ROLE` only after all six contracts are deployed, so the
CREATE addresses the frontend expects do not shift.

**Residual limitation (not fixed):** listings are not reserved. A seller can list the same credits
twice, or move them after listing; the second purchase then reverts atomically on the batch-balance
check. No buyer funds are lost, but the listing book can advertise more than the seller holds.

## 4b. Repository hygiene

Build output is no longer committed. `artifacts/`, `cache/` and `frontend/dist/` are gitignored and
regenerated by `npx hardhat compile` and `npm run build`; `*.log` is ignored too. This took the tracked
file count from 113 to 46 without losing anything that cannot be rebuilt in seconds.

---

## 5. How to run and verify

```bash
npm install
npx hardhat compile
npx hardhat test                                   # 115 passing

# Full local stack
npx hardhat node                                   # terminal 1
npx hardhat run scripts/deploy.js --network localhost   # terminal 2
cd frontend && npm install && npm run dev           # terminal 3  -> http://localhost:3000

# End-to-end check through the frontend ABIs (needs a fresh node + deploy)
cd frontend && node scripts/verify-integration.mjs  # 25 passed
```

Optional deploy flags:

```bash
MULTISIG_OWNERS=0xabc...,0xdef...,0x123...,0x456...,0x789... MULTISIG_THRESHOLD=3 \
  npx hardhat run scripts/deploy.js --network localhost
USE_MRV_ORACLE=true npx hardhat run scripts/deploy.js --network localhost
KEEP_DEPLOYER_REGULATOR=true npx hardhat run scripts/deploy.js --network localhost
```

---

## 6. Known limitations

1. **Mock oracle is admin-settable** — proves plumbing, not data provenance.
2. **Multisig owners are peers, not regulated entities** — adding/removing owners is itself a
   threshold action, but the initial panel is set by whoever deploys.
3. **Transfer freeze is admin-liftable** — `flagBatch(_, false)` restores transferability. That is a
   deliberate escape hatch, but it means the freeze is only as trustworthy as the admin key.
4. **Hardhat warns about Node v24** — everything passes, but Node 20 LTS is the supported target.
5. **Listings are not reserved.** The marketplace is escrow-free, so a seller can list the same
   credits in two listings or move them after listing. Settlement is now batch-faithful, so the
   later purchase reverts atomically instead of delivering the wrong project, but the listing book
   can advertise more than the seller holds. Reserving or escrowing listed credits would close it.
6. **The browser check drives the UI with an injected EIP-1193 provider, not real MetaMask.** It
   verifies rendering, wallet connect and live data binding against the real chain and the real app
   code, but MetaMask-specific UX (popup approval, network-switch prompts) is outside its reach.

The browser check exists because the "unverified rendering" caveat stood for the whole project: it
loads the real dev server in headless Chrome, connects through the app's own connect path, and asserts
what the DOM paints — every panel present, Total Supply bound to chain state, the multisig panel
showing its 3-of-5 threshold and five owners, and no console errors. It also caught a real bug on its
first run: the four original panels called `loadData()` from the mount effect with a stale closure, so
their first load no-oped and the UI stayed empty until the user's first action. All four now pass the
contract instance explicitly (the pattern the multisig panel already used).

The same check caught a second rendering defect on 2026-10-26: `VerifierStakePanel` drove every button
label from one `loading` flag, so while the panel refreshed its data all five actions read
"Depositing… / Withdrawing… / Challenging… / Resolving… / Claiming…". Actions now carry their own
`busy` key, leaving `loading` for the data fetch only. Verified by re-running all three live checks
(115 unit · 25 end-to-end · 13 browser) plus `npm run build` against a fresh node and deploy.
