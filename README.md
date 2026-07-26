# Blockchain-Based Carbon Credit Trading System

**Digital Assignment 1 (DA1) — Blockchain Technology**
**SDG 13 — Climate Action** (supporting SDG 7 & SDG 12)

A public-Ethereum system that tokenises carbon credits as unique, non-duplicable assets and enforces their full lifecycle — mint → trade → **retire (burn)** — on an immutable, publicly auditable ledger. It structurally eliminates the double-counting, opacity, and fraud that plague today's carbon markets.

## DA1 Deliverables
| Deliverable | Location |
|-------------|----------|
| Full written report (Word) | [`docs/DA1_Report.docx`](docs/DA1_Report.docx) |
| Report (Markdown, renders on GitHub) | [`docs/DA1_Report.md`](docs/DA1_Report.md) |
| Presentation (PowerPoint) | [`presentation/DA1_Presentation.pptx`](presentation/DA1_Presentation.pptx) |
| Design diagrams (PNG) | [`diagrams/`](diagrams/) |

The report and slides cover: **problem statement, objectives & scope (SDG-aligned) · literature survey & research gap · blockchain suitability (why Ethereum) · system architecture, workflow & design diagrams · project planning (timeline, milestones, feasibility).**

## Diagrams
| | |
|---|---|
| System Architecture | ![arch](diagrams/architecture.png) |
| Credit Lifecycle Workflow | ![flow](diagrams/workflow.png) |
| Sequence (Buy & Retire) | ![seq](diagrams/sequence.png) |
| Project Gantt | ![gantt](diagrams/gantt.png) |

## Regenerating the deliverables
```bash
pip install python-pptx python-docx matplotlib pillow
python diagrams/make_diagrams.py     # regenerate diagram PNGs
python build_deliverables.py         # rebuild DA1_Report.docx and DA1_Presentation.pptx
```

## Proposed Tech Stack (for later phases)
Solidity + OpenZeppelin (ERC-20 / AccessControl) · Hardhat · React + Web3.js · MetaMask · IPFS · Sepolia testnet · Layer-2 (Polygon/Arbitrum) for production.
