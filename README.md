# Blockchain Based Carbon Credit Trading System

**Digital Assignment 1 (DA1), Blockchain Technology**
**SDG 13, Climate Action** (also supports SDG 7 and SDG 12)
**By:** Avi Dhandhania (25BCE1207), Shivesh Kumar (25BCE1067)

A design for a public Ethereum system that turns carbon credits into tokens and keeps their whole life on a ledger anyone can read: mint, trade, then **retire by burning**. That much removes double counting.

The part we have not found elsewhere is what happens when the data going in is a lie. Verifiers have to **lock a deposit** before approving a project and lose it if the project is later shown to be fake, anyone can challenge a batch and get paid out of the slashed stake, and burning credits mints a **soulbound certificate** so an offset claim has a public owner and cannot be resold as proof. See Section 4.4 of the report.

## DA1 Deliverables
| Deliverable | Location |
|-------------|----------|
| Full report (Word) | [`docs/DA1_Report.docx`](docs/DA1_Report.docx) |
| Report (Markdown, renders on GitHub) | [`docs/DA1_Report.md`](docs/DA1_Report.md) |
| Presentation (PowerPoint) | [`presentation/DA1_Presentation.pptx`](presentation/DA1_Presentation.pptx) |
| Design diagrams (PNG) | [`diagrams/`](diagrams/) |

The report and slides cover the problem statement, objectives and scope against SDG 13, the literature survey and research gap, why Ethereum rather than Hyperledger, the architecture and workflow, what is new in our design, and the project plan with feasibility and risks.

## Diagrams
| | |
|---|---|
| System architecture | ![arch](diagrams/architecture.png) |
| Credit lifecycle | ![flow](diagrams/workflow.png) |
| Sequence, buy and retire | ![seq](diagrams/sequence.png) |
| Stake, challenge and slash (the new part) | ![new](diagrams/novelty.png) |
| Project gantt | ![gantt](diagrams/gantt.png) |

## Rebuilding the deliverables
```bash
pip install python-pptx python-docx matplotlib pillow
python diagrams/make_diagrams.py     # regenerate the diagram PNGs
python build_deliverables.py         # rebuild DA1_Report.docx and DA1_Presentation.pptx
```

Note: the report text lives in two places, `docs/DA1_Report.md` and `build_deliverables.py`. Edit both or they drift.

## Planned tech stack (later phases)
Solidity with OpenZeppelin (ERC-20, ERC-721, AccessControl), Hardhat, React with Web3.js, MetaMask, IPFS, the Sepolia testnet, and a Layer 2 (Polygon or Arbitrum) for production.
