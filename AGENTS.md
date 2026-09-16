# AGENTS.md — Carbon Credit Blockchain (DA1 Design + DA2 Implementation)

This repository contains the **design deliverables** for a blockchain-based carbon credit trading system (Digital Assignment 1) and the **50% implementation** for Digital Assignment 2.

## Repository Structure
```
├── build_deliverables.py          # Rebuilds .docx and .pptx from source (DA1)
├── contracts/                     # Solidity smart contracts (DA2)
│   ├── CreditToken.sol            # ERC-20 token with batch tracking
│   ├── Marketplace.sol            # Listing, buying, price updates
│   ├── RetireAndCertify.sol       # Burn credits + mint soulbound ERC-721
│   └── VerifierStake.sol          # Verifier deposits, challenges, slashing
├── diagrams/
│   ├── make_diagrams.py           # Generates all PNG diagrams
│   └── *.png                      # Generated diagrams
├── docs/
│   ├── DA1_Report.md              # Markdown report (renders on GitHub)
│   └── DA1_Report.docx            # Generated Word document
├── frontend/                      # React + Vite frontend (DA2)
│   ├── src/
│   │   ├── components/            # WalletConnect, CreditToken, Marketplace, RetireCertify, VerifierStake
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
│   └── CarbonCredit.test.js       # Comprehensive test suite (36 passing)
├── hardhat.config.js
├── package.json
└── README.md
```

## Key Commands
```bash
# Smart Contract Development
npm install                           # Install dependencies
npx hardhat compile                   # Compile contracts
npx hardhat test                      # Run tests (44 passing)
npx hardhat node                      # Start local Hardhat node
npx hardhat run scripts/deploy.js --network localhost  # Deploy locally
npx hardhat run scripts/deploy.js --network sepolia   # Deploy to Sepolia

# Frontend
cd frontend && npm install            # Install frontend deps
cd frontend && npm run dev            # Start dev server (port 3000)
cd frontend && npm run build          # Build for production

# DA1 Deliverables (Design Phase)
python diagrams/make_diagrams.py      # Regenerate all diagrams
python build_deliverables.py          # Rebuild DA1_Report.docx and DA1_Presentation.pptx
pip install python-pptx python-docx matplotlib pillow  # Dependencies
```

## Important Notes
- **Report content lives in two places**: `docs/DA1_Report.md` AND `build_deliverables.py` — edit both or they drift
- **Diagrams are generated** — do not edit PNGs directly; modify `diagrams/make_diagrams.py`
- **Contract addresses** — Update `frontend/src/utils/contracts.js` after deployment
- **Test coverage**: 44 passing tests covering all 4 contracts (CreditToken, Marketplace, RetireAndCertify, VerifierStake)

## Implementation Status (DA2 - 50% Complete)
| Module | Status | Description |
|--------|--------|-------------|
| **CreditToken** | ✅ Done | ERC-20 with batch tracking, mint/retire/flag, role-based access |
| **Marketplace** | ✅ Done | Create/cancel listings, buy tokens, price updates |
| **RetireAndCertify** | ✅ Done | Burn credits, mint soulbound ERC-721 certificates (non-transferable) |
| **VerifierStake** | ✅ Done | Deposit/withdraw stake, create/resolve challenges, slashing |
| **Tests** | ✅ Done | 44 passing tests covering all functionality |
| **Frontend** | ✅ Done | React + Vite + MetaMask integration for all 4 modules |
| **Deployment** | ✅ Ready | Hardhat deploy script with role configuration |

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