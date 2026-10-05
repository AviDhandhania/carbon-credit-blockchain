# AGENTS.md — Carbon Credit Blockchain (DA1 Design + DA2/DA3 Implementation)

This repository contains the **design deliverables** for a blockchain-based carbon credit trading system (Digital Assignment 1), the core implementation for Digital Assignment 2, and the roadmap features for DA3.

**Progress tracking lives in [`PROGRESS.md`](PROGRESS.md)** — check it before starting work and update it when you finish.

## Repository Structure
```
├── build_deliverables.py          # Rebuilds .docx and .pptx from source (DA1)
├── contracts/                     # Solidity smart contracts
│   ├── interfaces/
│   │   └── IMRVOracle.sol         # MRV oracle interface
│   ├── CreditToken.sol            # ERC-20 token with batch tracking + fractionalization
│   ├── Marketplace.sol            # Listing, buying, price updates
│   ├── MockMRVOracle.sol          # Settable MRV attestation stand-in
│   ├── RegulatorMultisig.sol      # 3-of-5 panel gating challenge resolution
│   ├── RetireAndCertify.sol       # Burn credits + mint soulbound ERC-721
│   └── VerifierStake.sol          # Stakes, challenges, configurable windows, pro-rata pools
├── diagrams/
│   ├── make_diagrams.py           # Generates all PNG diagrams
│   └── *.png                      # Generated diagrams
├── docs/
│   ├── DA1_Report.md              # Markdown report (renders on GitHub)
│   └── DA1_Report.docx            # Generated Word document
├── frontend/                      # React + Vite frontend (DA2)
│   ├── scripts/
│   │   └── verify-integration.mjs # End-to-end check through the frontend ABIs
│   ├── src/
│   │   ├── components/            # WalletConnect, CreditToken, Marketplace, RetireCertify,
│   │   │                          # VerifierStake, RegulatorMultisig
│   │   ├── utils/contracts.js     # Contract addresses & ABIs
│   │   ├── App.jsx                # Main app with wallet connection
│   │   └── main.jsx               # Entry point
│   ├── index.html
│   ├── package.json
│   └── vite.config.js
├── presentation/
│   └── DA1_Presentation.pptx      # Generated PowerPoint
├── scripts/
│   └── deploy.js                  # Hardhat deployment script
├── test/
│   ├── CarbonCredit.test.js       # Core suite for the four original contracts
│   └── DA3Features.test.js        # Fractionalization, MRV oracle, windows, pools, multisig
├── PROGRESS.md                    # Status + roadmap tracker (keep this current)
├── hardhat.config.js
├── package.json
└── README.md
```

## Key Commands
```bash
# Smart Contract Development
npm install                           # Install dependencies
npx hardhat compile                   # Compile contracts
npx hardhat test                      # Run tests (106 passing)
npx hardhat node                      # Start local Hardhat node
npx hardhat run scripts/deploy.js --network localhost  # Deploy locally (6 contracts)
npx hardhat run scripts/deploy.js --network sepolia   # Deploy to Sepolia

# Frontend
cd frontend && npm install            # Install frontend deps
cd frontend && npm run dev            # Start dev server (port 3000)
cd frontend && npm run build          # Build for production
cd frontend && node scripts/verify-integration.mjs  # E2E check (fresh node + deploy required)

# DA1 Deliverables (Design Phase)
python diagrams/make_diagrams.py      # Regenerate all diagrams
python build_deliverables.py          # Rebuild DA1_Report.docx and DA1_Presentation.pptx
pip install python-pptx python-docx matplotlib pillow  # Dependencies
```

## Important Notes
- **Report content lives in two places**: `docs/DA1_Report.md` AND `build_deliverables.py` — edit both or they drift
- **Diagrams are generated** — do not edit PNGs directly; modify `diagrams/make_diagrams.py`
- **Contract addresses** — Update `frontend/src/utils/contracts.js` after deployment
- **Test coverage**: 106 passing tests covering all 6 contracts (CreditToken, Marketplace, RetireAndCertify, VerifierStake, RegulatorMultisig, MockMRVOracle)
- **Status is tracked in `PROGRESS.md`** — update it when you change what is built or verified

## Implementation Status (Complete)
| Module | Status | Description |
|--------|--------|-------------|
| **CreditToken** | ✅ Done | ERC-20 with batch tracking, mint/retire/flag, batch fractionalization, optional MRV gate |
| **Marketplace** | ✅ Done | Create/cancel listings, buy tokens, price updates |
| **RetireAndCertify** | ✅ Done | Burn credits, mint soulbound ERC-721 certificates (non-transferable) |
| **VerifierStake** | ✅ Done | Stakes, challenges, configurable per-batch windows, per-batch pro-rata compensation pools |
| **RegulatorMultisig** | ✅ Done | 3-of-5 panel holds REGULATOR_ROLE; single-key regulation revoked at deploy |
| **MockMRVOracle** | ✅ Done | Settable MRV attestation stand-in behind `IMRVOracle` |
| **Tests** | ✅ Done | 106 passing tests (44 core + 62 DA3) |
| **Frontend** | ✅ Done | React + Vite + MetaMask integration for all 6 contracts |
| **Deployment** | ✅ Done | Hardhat deploy script, role wiring, multisig + oracle deployment |
| **E2E check** | ✅ Done | `frontend/scripts/verify-integration.mjs`, 25 assertions against a live chain |

See [`PROGRESS.md`](PROGRESS.md) for the roadmap tracker and known limitations.

## Design Highlights (from DA1)
- Public Ethereum (not permissioned) — regulators/public must verify
- ERC-20 for credits (fungible per batch), ERC-721 non-transferable for retirement certificates
- IPFS for project docs; only hashes on-chain
- Retirement = irreversible burn (prevents double-counting by design)
- OpenZeppelin AccessControl for 4 roles: developer, verifier, buyer, regulator

## Novel Mechanism (Implemented)
- **Verifier Stake**: Verifiers lock ≥1 ETH deposit before approving projects
- **Challenge Window**: 90-day window for anyone to challenge with 0.1 ETH bond + IPFS evidence
- **Slashing**: If challenge succeeds, half stake slashed (half to challenger, half to compensation pool)
- **Soulbound Certificates**: ERC-721 with transfers disabled — cannot be transferred, approved, or resold

## Planned Tech Stack (Production)
Solidity + OpenZeppelin (ERC-20, ERC-721, AccessControl), Hardhat, React + Vite + ethers.js, MetaMask, IPFS, Sepolia testnet, Layer 2 (Polygon/Arbitrum)