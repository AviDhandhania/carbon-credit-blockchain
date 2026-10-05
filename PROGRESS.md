# Project Progress

Single source of truth for what is built, what is verified, and what is deliberately out of scope.

**Last updated:** 2026-10-05
**Status:** DA1 complete · DA2 complete · DA3 complete (all in-repo roadmap items)

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
| Unit suite | `npx hardhat test` | **106 passing, 0 failing** (exit 0) |
| Contract compile | `npx hardhat compile` | 7 Solidity files, 0 errors |
| Local deploy | `npx hardhat run scripts/deploy.js --network localhost` | 6 contracts, exit 0 |
| End-to-end (live chain, frontend ABIs) | `cd frontend && node scripts/verify-integration.mjs` | **25 passed, 0 failed** (exit 0) |
| Frontend build | `cd frontend && npm run build` | success, exit 0 |

Test count history: the DA2 report and `AGENTS.md` disagreed (`36` vs `44`); both were stale. The
suite is now **106** tests — 44 pre-existing plus 62 covering the DA3 features.

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
- the **slashed verifier is blocked** from claiming out of the pool meant for the buyers it misled.

**Known limitation:** the denominator is frozen at resolution but balances are read live, so an address
that acquires tokens *after* resolution and before claiming is treated as a legitimate holder. Flagging
the batch freezes retirement and certification, but not plain ERC-20 transfers. A production version
should snapshot the holder set at resolution. Documented, not hidden.

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
| Tests | ✅ Done | 106 passing |
| End-to-end check | ✅ Done | `frontend/scripts/verify-integration.mjs`, 25 assertions |

---

## 5. How to run and verify

```bash
npm install
npx hardhat compile
npx hardhat test                                   # 106 passing

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

1. **Compensation claimant set** — as in §2.5, post-resolution buyers can claim. Needs a holder snapshot.
2. **Mock oracle is admin-settable** — proves plumbing, not data provenance.
3. **Multisig owners are peers, not regulated entities** — adding/removing owners is itself a
   threshold action, but the initial panel is set by whoever deploys.
4. **Hardhat warns about Node v24** — everything passes, but Node 20 LTS is the supported target.
5. **Browser rendering is unverified in CI** — the dev server and every component compile, and the
   ABIs are exercised against a live chain, but no headless-browser run asserts what the panels paint.
