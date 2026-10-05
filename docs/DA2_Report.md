# Digital Assignment 2 (DA2) Report
## Blockchain Based Carbon Credit Trading System

**Course:** Blockchain Technology  
**Assessment:** Digital Assignment 2 (DA2)  
**SDG:** SDG 13, Climate Action (also supports SDG 7 and SDG 12)  
**Submitted by:** Avi Dhandhania (25BCE1207), Shivesh Kumar (25BCE1067)  
**Date:** September 2026

---

## 1. Introduction

Carbon credit markets suffer from fundamental trust issues: double counting, phantom credits, opaque verification, and slow settlement. Our Digital Assignment 1 (DA1) proposed a public Ethereum-based system that addresses these through on-chain lifecycle enforcement, role-based access control, and a novel verifier stake-and-challenge mechanism.

This report documents the **50% implementation (DA2)** of that design — a working end-to-end prototype covering the complete credit lifecycle: minting, trading, retirement, and certification, plus the verifier staking and challenge system.

### Objectives Achieved in DA2

| Objective | Status |
|-----------|--------|
| O1: One credit = one token, cannot be copied | ✅ ERC-20 with batch tracking |
| O2: Mint, sell, retire in contract code | ✅ All lifecycle in 4 contracts |
| O3: Full public history | ✅ All events on-chain |
| O4: Cut middlemen | ✅ Direct P2P marketplace |
| O5: Four on-chain roles | ✅ AccessControl: developer, verifier, buyer, regulator |
| O6: Verifiers stake and lose on fraud | ✅ VerifierStake with slashing |

### Novel Features Implemented

1. **Verifier Stake & Challenge** — Verifiers deposit ≥1 ETH; 90-day challenge window; slashing on proven fraud
2. **Batch Traceability** — Every ERC-20 mint links to project ID, verifier, and IPFS evidence hash
3. **Soulbound Retirement Certificates** — Burning credits mints non-transferable ERC-721 (EIP-5192 style)

---

## 2. Related Works

| Work | Approach | Our Differentiation |
|------|----------|---------------------|
| **Toucan Protocol** | Bridge existing registry credits to ERC-20 (Base Carbon Tonne) | We mint native credits with on-chain evidence; no trusted bridge needed |
| **KlimaDAO** | Tokenized carbon as treasury asset | Our goal is honest accounting, not financial engineering |
| **IBM / Energy Web** | Permissioned Fabric for enterprise tracking | We use public Ethereum — regulators and public can verify |
| **Verra / Gold Standard** | Centralized registries, PDF-based verification | We anchor evidence hashes on-chain; verifier stake penalizes fraud |
| **Academic surveys (2019-2023)** | Conceptual smart contract designs | We deliver working Solidity + React implementation with tests |

**Key gap we close (G4 from DA1):** Existing systems assume honest data entry. Our verifier stake mechanism makes false approvals *economically costly* — a first for on-chain carbon credit systems.

---

## 3. Methodology

### 3.1 System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    PRESENTATION LAYER                        │
│  React + Vite Frontend ── MetaMask Wallet Connection        │
└─────────────────────────────────────────────────────────────┘
                              │ ethers.js
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    BLOCKCHAIN LAYER (Ethereum)               │
│  ┌──────────────┐  ┌─────────────┐  ┌────────────────────┐  │
│  │ CreditToken  │  │ Marketplace │  │ RetireAndCertify   │  │
│  │  (ERC-20)    │  │  (List/Buy) │  │  (Burn + SBT)      │  │
│  └──────────────┘  └─────────────┘  └────────────────────┘  │
│  ┌──────────────────────────────────────────────────────┐   │
│  │              VerifierStake (Stake/Challenge)          │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    STORAGE LAYER                             │
│  On-chain: Events, balances, roles, batches, certificates   │
│  IPFS: Project documents (hashes on-chain only)             │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 Smart Contract Design

#### CreditToken.sol (ERC-20 + Batch Tracking)
- **Inheritance**: `ERC20`, `ERC20Burnable`, `AccessControl`
- **Roles**: `MINTER_ROLE`, `VERIFIER_ROLE`
- **Batch Struct**: `batchId`, `projectId`, `verifier`, `ipfsHash`, `amount`, `timestamp`, `isRetired`, `isFlagged`
- **Key Functions**:
  - `mintBatch(projectId, ipfsHash, amount)` → creates batch, mints to caller
  - `retireBatch(batchId, amount)` / `retireBatchFrom(from, batchId, amount)` — burns tokens
  - `flagBatch(batchId, bool)` — admin-only, marks batch as fraudulent
  - `getBatchInfo(batchId)` — returns full batch metadata

#### Marketplace.sol (Listing & Trading)
- **Inheritance**: `AccessControl`, `ReentrancyGuard`
- **Roles**: `BUYER_ROLE`, `MARKETPLACE_ADMIN_ROLE`
- **Listing Struct**: `listingId`, `batchId`, `seller`, `amount`, `pricePerToken`, `isActive`, `createdAt`
- **Key Functions**:
  - `createListing(batchId, amount, pricePerToken)` — seller approves tokens, creates listing
  - `buyTokens(listingId, amount)` — buyer pays ETH, receives tokens via `transferFrom`
  - `cancelListing(listingId)` — seller cancels, revokes approval
  - `updateListingPrice(listingId, newPrice)` — seller updates price

#### RetireAndCertify.sol (Burn + Soulbound Certificate)
- **Inheritance**: `ERC721URIStorage`, `AccessControl`
- **Roles**: `RETIRE_ROLE`, `REGULATOR_ROLE`
- **Certificate Struct**: `certificateId`, `owner`, `batchId`, `amountRetired`, `projectId`, `retirementTimestamp`, `metadataURI`
- **Soulbound Enforcement**: Overrides `_update`, `approve`, `setApprovalForAll` to revert on any transfer
- **Key Functions**:
  - `retireAndCertify(batchId, amount, metadataURI)` — calls `CreditToken.retireBatchFrom`, mints SBT
  - `getCertificate(certificateId)` — returns certificate metadata

#### VerifierStake.sol (Stake, Challenge, Slash)
- **Inheritance**: `AccessControl`, `ReentrancyGuard`
- **Roles**: `VERIFIER_ROLE`, `REGULATOR_ROLE`, `CHALLENGER_ROLE`
- **Constants**: `MIN_STAKE = 1 ETH`, `CHALLENGE_BOND = 0.1 ETH`, `CHALLENGE_WINDOW = 90 days`
- **Key Functions**:
  - `depositStake()` / `withdrawStake(amount)` — verifier stake management
  - `createChallenge(batchId, evidenceHash)` — challenger posts bond + IPFS evidence
  - `resolveChallenge(challengeId, challengerWins)` — regulator rules; slashes or refunds
- **Slashing Logic**: If challenger wins → 50% stake slashed; 50% to challenger, 50% to compensation pool; batch flagged

### 3.3 Frontend Architecture (React + Vite)

| Component | Responsibility |
|-----------|----------------|
| `WalletConnect` | MetaMask detection, connection, network switching (Sepolia/Localhost) |
| `CreditTokenPanel` | Mint batches, retire tokens, view batch history |
| `MarketplacePanel` | Create/cancel listings, buy credits, view active/user listings |
| `RetireCertifyPanel` | Retire credits + mint soulbound certificates, view certificates |
| `VerifierStakePanel` | Deposit/withdraw stake, create challenges, resolve challenges |

**Key Integration Points**:
- Single `BrowserProvider` / `Signer` passed to all panels
- Contract addresses and ABIs centralized in `src/utils/contracts.js`
- Real-time event listening via contract filters
- Gas estimation handled gracefully with user-friendly errors

### 3.4 Testing Methodology

**Framework**: Hardhat + Chai + ethers.js v6  
**Coverage**: 44 passing tests across 4 contract suites (this suite). The repository total is now
106 passing after the DA3 additions — see [`PROGRESS.md`](../PROGRESS.md).

| Test Suite | Tests | Coverage |
|------------|-------|----------|
| CreditToken | 10 | Mint, retire, flag, roles, batch tracking |
| Marketplace | 12 | List, buy, cancel, price update, roles |
| RetireAndCertify | 9 | Retire+certify, soulbound enforcement, metadata |
| VerifierStake | 10 | Stake, challenge, resolve, slashing |

**Test Patterns**:
- Role-based access control verification
- State transition validation (active → inactive listings)
- Reentrancy guard verification
- Soulbound transfer prevention
- Gas-efficient batch operations

### 3.5 Deployment & Operations

**Local Development**:
```bash
npx hardhat node                          # Terminal 1: local chain
npx hardhat run scripts/deploy.js --network localhost  # Terminal 2
cd frontend && npm run dev                # Terminal 3: frontend at localhost:3000
```

**Testnet Deployment (Sepolia)**:
```bash
# .env required: SEPOLIA_RPC_URL, PRIVATE_KEY, ETHERSCAN_API_KEY
npx hardhat run scripts/deploy.js --network sepolia
npx hardhat verify --network sepolia <address> <constructor_args>
```

**Deploy Script** (`scripts/deploy.js`):
- Deploys all 4 contracts in dependency order
- Grants all roles to deployer
- Grants `DEFAULT_ADMIN_ROLE` on CreditToken to Marketplace, RetireAndCertify, VerifierStake for cross-contract calls

### 3.6 Security Considerations

| Concern | Mitigation |
|---------|------------|
| Reentrancy | `ReentrancyGuard` on all state-changing functions |
| Access Control | OpenZeppelin `AccessControl` — battle-tested |
| Soulbound Integrity | Override `_update`, `approve`, `setApprovalForAll` to revert on transfer |
| Gas Limits | Frontend sets explicit gas limits; batch operations where possible |
| Front-running | Single-transaction retire+certify; challenge bond discourages spam |
| Upgradeability | Not needed for DA2; DA3 may add proxy pattern |

---

## 4. Current Limitations & DA3 Roadmap

| Limitation | DA3 Plan | Status |
|------------|----------|--------|
| Single regulator address | Multi-sig regulator panel (e.g., 3-of-5) | ✅ `RegulatorMultisig.sol` — 3-of-5, single-key role revoked at deploy |
| Fixed challenge window | Configurable per-batch window | ✅ `defaultChallengeWindow` + per-batch override, 1–365 day bounds |
| No oracle integration | Satellite/MRV data oracle for automated evidence | ✅ `IMRVOracle` + `MockMRVOracle`; `CreditToken` gates mints when wired |
| Single compensation pool | Per-batch compensation pools with pro-rata distribution | ✅ `claimCompensation`, pro-rata by frozen supply snapshot |
| Localhost/Sepolia only | Mainnet + Polygon/Arbitrum L2 deployment | ⛔ Blocked: needs funded keys (configuration only, no code) |
| No batch fractionalization | Allow splitting batches for granular trading | ✅ `CreditToken.splitBatch`, supply-invariant |
| No off-ramp | Fiat on/off-ramp integration | ⛔ Out of scope: needs a payments vendor and KYC |

---

## 5. Conclusion

DA2 delivers a **working 50% implementation** of the carbon credit trading system designed in DA1. All four core smart contracts are implemented, tested (44 passing in this suite), and integrated into a React frontend with MetaMask wallet connection. The novel verifier stake-and-challenge mechanism is fully functional, making this the first known on-chain carbon credit system where fraudulent verification carries direct economic consequences.

Everything listed in §4 below has since been implemented; [`PROGRESS.md`](../PROGRESS.md) tracks the current state, the evidence, and the items that remain deliberately out of scope.

The system is ready for Sepolia testnet deployment and real-world pilot testing with accredited verifiers.

---

## Appendix: Contract Addresses (Localhost)

Deterministic addresses from a fresh `npx hardhat node` followed by `npm run deploy:local`.
These are the values hard-coded in `frontend/src/utils/contracts.js`.

| Contract | Address | Network |
|----------|---------|---------|
| CreditToken | `0x5FbDB2315678afecb367f032d93F642f64180aa3` | Hardhat localhost (31337) |
| Marketplace | `0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512` | Hardhat localhost (31337) |
| RetireAndCertify | `0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0` | Hardhat localhost (31337) |
| VerifierStake | `0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9` | Hardhat localhost (31337) |
| RegulatorMultisig | `0xa513E6E4b8f2a923D98304ec87F64353C4D5C853` | Hardhat localhost (31337) |
| MockMRVOracle | `0x2279B7A0a67DB372996a5FaB50D91eAA73d2eBe6` | Hardhat localhost (31337) |

Deployment order is significant: the first four are deployed before the role-grant transactions so
their addresses stay stable across reruns. For Sepolia, deploy and then update
`frontend/src/utils/contracts.js` — no public deployment is currently recorded.