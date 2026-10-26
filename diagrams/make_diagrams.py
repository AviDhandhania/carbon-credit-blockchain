"""Generate DA1 diagrams as PNGs: system architecture, workflow, sequence, gantt.
Run: python make_diagrams.py  (writes *.png into this folder)
"""
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
from matplotlib.patches import FancyArrowPatch, FancyBboxPatch
import os

OUT = os.path.dirname(os.path.abspath(__file__))
NAVY, TEAL, GREEN, AMBER, GREY = "#1f3a5f", "#2a9d8f", "#43aa8b", "#e9c46a", "#adb5bd"

def box(ax, x, y, w, h, text, fc, tc="white", fs=10):
    ax.add_patch(FancyBboxPatch((x, y), w, h, boxstyle="round,pad=0.02,rounding_size=0.08",
                                fc=fc, ec="#0d1b2a", lw=1.3))
    ax.text(x + w / 2, y + h / 2, text, ha="center", va="center", color=tc,
            fontsize=fs, weight="bold", wrap=True)

def arrow(ax, x1, y1, x2, y2, text="", color="#0d1b2a", style="-|>"):
    ax.add_patch(FancyArrowPatch((x1, y1), (x2, y2), arrowstyle=style,
                                 mutation_scale=16, lw=1.5, color=color))
    if text:
        ax.text((x1 + x2) / 2, (y1 + y2) / 2 + 0.12, text, ha="center",
                va="center", fontsize=8, color=color, style="italic")

# ---------------------------------------------------------------- ARCHITECTURE
def architecture():
    fig, ax = plt.subplots(figsize=(11, 8.0))
    ax.set_xlim(0, 12); ax.set_ylim(0, 10.6); ax.axis("off")
    ax.text(6, 10.3, "System Architecture: Blockchain Carbon Credit Trading",
            ha="center", fontsize=14, weight="bold", color=NAVY)

    # Layer bands
    layers = [("PRESENTATION", 8.0, "#eef2f7"),
              ("APPLICATION", 5.6, "#e6f4f1"),
              ("BLOCKCHAIN", 3.0, "#e8f5e9"),
              ("STORAGE", 0.6, "#fff5e0")]
    for name, y, c in layers:
        ax.add_patch(FancyBboxPatch((0.3, y), 11.4, 1.9, boxstyle="round,pad=0.02",
                                    fc=c, ec=GREY, lw=1))
        # ponytail: rotated in the left margin so the vertical arrows never cross the label
        ax.text(0.5, y + 0.95, name, fontsize=8.5, weight="bold", color=NAVY,
                rotation=90, ha="center", va="center")

    # Presentation
    box(ax, 1.0, 8.3, 2.6, 1.2, "Web DApp\n(React + Web3.js)", NAVY)
    box(ax, 4.4, 8.3, 2.6, 1.2, "MetaMask\nWallet", NAVY)
    box(ax, 7.8, 8.3, 3.4, 1.2, "Verifier / Regulator\nDashboard", NAVY)
    # Application
    box(ax, 1.0, 5.9, 3.0, 1.2, "REST API\n(Node.js/Express)", TEAL)
    box(ax, 4.6, 5.9, 3.0, 1.2, "Auth &\nRole Manager", TEAL)
    box(ax, 8.2, 5.9, 3.0, 1.2, "Off-chain\nOracle Adapter", TEAL)
    # Blockchain
    box(ax, 0.75, 3.3, 2.5, 1.2, "CreditToken\n(ERC-20 + batches)", GREEN, fs=9)
    box(ax, 3.5, 3.3, 2.5, 1.2, "Marketplace\nContract", GREEN, fs=9)
    box(ax, 6.25, 3.3, 2.5, 1.2, "RetireAndCertify\n(burn + SBT)", GREEN, fs=9)
    box(ax, 9.0, 3.3, 2.5, 1.2, "VerifierStake\n(stake + challenge)", GREEN, fs=9)
    # Storage
    box(ax, 1.0, 0.85, 3.0, 1.2, "On-chain Ledger\n(Tx history)", AMBER, tc="#3a2f00")
    box(ax, 4.6, 0.85, 3.0, 1.2, "IPFS\n(Project docs)", AMBER, tc="#3a2f00")
    box(ax, 8.2, 0.85, 3.0, 1.2, "Off-chain DB\n(Metadata cache)", AMBER, tc="#3a2f00")

    for x in (2.5, 6.1, 9.7):
        arrow(ax, x, 8.3, x, 7.1)       # presentation -> app
    for x in (2.0, 4.75, 7.5, 10.25):   # aligned to the 4 contract boxes
        arrow(ax, x, 5.9, x, 4.5)       # app -> blockchain
        arrow(ax, x, 3.3, x, 2.05)      # blockchain -> storage
    fig.savefig(os.path.join(OUT, "architecture.png"), dpi=150, bbox_inches="tight")
    plt.close(fig)

# ---------------------------------------------------------------- WORKFLOW
def workflow():
    fig, ax = plt.subplots(figsize=(11, 5))
    ax.set_xlim(0, 12); ax.set_ylim(0, 5); ax.axis("off")
    ax.text(6, 4.6, "Carbon Credit Lifecycle Workflow", ha="center",
            fontsize=14, weight="bold", color=NAVY)
    steps = [("1. Project\nregistered\n(docs to IPFS)", NAVY),
             ("2. Verifier\nstakes deposit\n+ approves", TEAL),
             ("3. Credits minted\nas traceable\nbatch", GREEN),
             ("4. Company\nbuys credits", GREEN),
             ("5. Credits\nretired\n(burned)", AMBER),
             ("6. Soulbound\ncertificate\nissued", AMBER),
             ("7. Public trail\n+ challenge\nwindow (90 d)", NAVY)]
    x = 0.3; w = 1.5; gap = 0.15; y = 2.1
    for i, (t, c) in enumerate(steps):
        tc = "#3a2f00" if c == AMBER else "white"
        box(ax, x, y, w, 1.4, t, c, tc=tc, fs=7.5)
        if i < len(steps) - 1:
            arrow(ax, x + w, y + 0.7, x + w + gap, y + 0.7)
        x += w + gap
    ax.text(6, 1.15, "Once retired, a credit cannot be resold: there is nothing left to sell.",
            ha="center", fontsize=9, style="italic", color="#555")
    ax.text(6, 0.7, "The certificate cannot be transferred, so the same offset cannot be claimed twice.",
            ha="center", fontsize=9, style="italic", color="#555")
    fig.savefig(os.path.join(OUT, "workflow.png"), dpi=150, bbox_inches="tight")
    plt.close(fig)

# ---------------------------------------------------------------- SEQUENCE
def sequence():
    fig, ax = plt.subplots(figsize=(11, 6.5))
    ax.set_xlim(0, 12); ax.set_ylim(0, 10); ax.axis("off")
    ax.text(6, 9.6, "Sequence Diagram: Buy and Retire a Carbon Credit",
            ha="center", fontsize=13, weight="bold", color=NAVY)
    actors = [("Buyer\n(Company)", 1.3), ("Web DApp", 3.6),
              ("Marketplace\nContract", 6.0), ("RetireAndCertify\nContract", 8.4),
              ("Ethereum\nBlockchain", 10.8)]
    for name, x in actors:
        box(ax, x - 1.05, 8.3, 2.1, 0.9, name, NAVY, fs=8)
        ax.plot([x, x], [0.4, 8.3], color=GREY, ls="--", lw=1)
    msgs = [(1.3, 3.6, "1: connect wallet, pick a batch", 7.7),
            (3.6, 6.0, "2: buyCredit(batchId, qty)", 6.9),
            (6.0, 10.8, "3: move tokens, record tx", 6.1),
            (10.8, 6.0, "4: tx confirmed (hash)", 5.3),
            (6.0, 1.3, "5: ownership updated", 4.5),
            (1.3, 8.4, "6: retire(batchId, qty)", 3.7),
            (8.4, 10.8, "7: burn tokens + mint certificate (one tx)", 2.9),
            (10.8, 8.4, "8: certificate id + tx hash", 2.1),
            (8.4, 1.3, "9: soulbound certificate, cannot be transferred", 1.3),
            (1.3, 10.8, "10: anyone can verify the claim on chain", 0.7)]
    for x1, x2, t, y in msgs:
        arrow(ax, x1, y, x2, y)
        ax.text((x1 + x2) / 2, y + 0.12, t, ha="center", fontsize=8, color="#222")
    fig.savefig(os.path.join(OUT, "sequence.png"), dpi=150, bbox_inches="tight")
    plt.close(fig)

# ---------------------------------------------------------------- GANTT
def gantt():
    fig, ax = plt.subplots(figsize=(11, 5.5))
    tasks = [
        ("Requirement analysis & literature survey", 0, 2, TEAL),
        ("System design & architecture (DA1)", 1, 2, TEAL),
        ("Smart contract development (Solidity)", 3, 3, GREEN),
        ("Frontend DApp + Web3 integration", 4, 3, GREEN),
        ("Staking, challenge & certificate module", 5, 3, TEAL),
        ("Oracle / IPFS integration", 6, 2, GREEN),
        ("Testing on testnet (Sepolia)", 7, 2, AMBER),
        ("Security audit & gas optimization", 9, 1, AMBER),
        ("Documentation & final demo", 9, 2, NAVY),
    ]
    # ponytail: names on the y-axis, not inside the bars - a 1-week bar can never fit its label
    for i, (name, start, dur, c) in enumerate(tasks):
        y = len(tasks) - i
        ax.barh(y, dur, left=start, height=0.55, color=c, edgecolor="#0d1b2a")
        ax.text(start + dur / 2, y, f"W{start}-W{start + dur}", ha="center", va="center",
                color="white" if c != AMBER else "#3a2f00", fontsize=7.5, weight="bold")
    ax.set_yticks([len(tasks) - i for i in range(len(tasks))])
    ax.set_yticklabels([t[0] for t in tasks], fontsize=9)
    ax.set_xlim(0, 11)
    ax.set_xticks(range(0, 12))
    ax.set_xticklabels([f"W{i}" for i in range(0, 12)], fontsize=9)
    ax.set_xlabel("Project Timeline (Weeks)", fontsize=10, weight="bold")
    ax.set_title("Project Plan: Gantt Chart", fontsize=13, weight="bold", color=NAVY)
    ax.grid(axis="x", ls=":", alpha=0.5)
    fig.savefig(os.path.join(OUT, "gantt.png"), dpi=150, bbox_inches="tight")
    plt.close(fig)

# ---------------------------------------------------------------- NOVELTY
def novelty():
    """Verifier stake -> challenge window -> slash or settle. The new part of the design."""
    fig, ax = plt.subplots(figsize=(11, 6.2))
    ax.set_xlim(0, 12); ax.set_ylim(0, 7.4); ax.axis("off")
    ax.text(6, 7.0, "What is New: Verifiers Put Money at Risk",
            ha="center", fontsize=14, weight="bold", color=NAVY)
    ax.text(6, 6.55, "The chain does not just record the approval, it makes a false approval expensive",
            ha="center", fontsize=9.5, style="italic", color="#555")

    box(ax, 0.4, 4.6, 2.4, 1.3, "Verifier locks\na deposit", TEAL, fs=10)
    box(ax, 3.3, 4.6, 2.4, 1.3, "Approves project\n(evidence hash\non chain)", TEAL, fs=9)
    box(ax, 6.2, 4.6, 2.5, 1.3, "Credits minted\nas traceable\nbatch", GREEN, fs=9)
    box(ax, 9.2, 4.6, 2.4, 1.3, "90-day\nchallenge\nwindow opens", NAVY, fs=9)
    arrow(ax, 2.8, 5.25, 3.3, 5.25)
    arrow(ax, 5.7, 5.25, 6.2, 5.25)
    arrow(ax, 8.7, 5.25, 9.2, 5.25)

    box(ax, 4.4, 2.9, 3.2, 1.1, "Anyone may challenge\n(posts a bond + evidence)", AMBER, tc="#3a2f00", fs=9)
    arrow(ax, 10.4, 4.6, 7.6, 4.0)
    box(ax, 4.4, 1.55, 3.2, 0.9, "Regulator rules\non the challenge", NAVY, fs=9)
    arrow(ax, 6.0, 2.9, 6.0, 2.45)

    box(ax, 0.4, 0.25, 3.4, 1.0, "Challenge fails:\nchallenger loses bond,\ncredits stand", GREEN, fs=9)
    box(ax, 8.2, 0.25, 3.4, 1.0, "Challenge succeeds:\nstake slashed, batch flagged,\nbuyers compensated", "#e63946", fs=9)
    arrow(ax, 4.4, 2.0, 2.1, 1.25)
    arrow(ax, 7.6, 2.0, 9.9, 1.25)

    ax.text(2.1, 0.02, "junk challenges do not pay", ha="center", fontsize=8, style="italic", color="#555")
    ax.text(9.9, 0.02, "part of the stake pays the challenger", ha="center", fontsize=8, style="italic", color="#555")
    fig.savefig(os.path.join(OUT, "novelty.png"), dpi=150, bbox_inches="tight")
    plt.close(fig)

# ---------------------------------------------------------------- DA3 ARCHITECTURE
def da3_architecture():
    """The implemented system: six contracts, a wallet-only frontend, and the
    off-chain components they depend on. Unlike the DA1 figure there is no REST
    API and no database, because the implementation has neither. Contract
    interactions are written into the boxes rather than drawn as arrows: the
    calls cross the same contract band and arrows between those boxes were
    easier to misread than to read."""
    fig, ax = plt.subplots(figsize=(12.4, 8.8))
    ax.set_xlim(0, 12.4); ax.set_ylim(0, 9.0); ax.axis("off")
    ax.text(6.2, 8.65, "Implemented Architecture: Six-Contract Carbon Credit System",
            ha="center", fontsize=14, weight="bold", color=NAVY)

    bands = [("ACTORS", 7.35, 1.2, "#eef2f7"),
             ("PRESENTATION", 5.75, 1.35, "#e6f4f1"),
             ("ON-CHAIN CONTRACTS", 2.55, 2.95, "#e8f5e9"),
             ("OFF-CHAIN", 0.35, 1.75, "#fff5e0")]
    for name, y, h, c in bands:
        ax.add_patch(FancyBboxPatch((0.25, y), 11.9, h, boxstyle="round,pad=0.02",
                                    fc=c, ec=GREY, lw=1))
        ax.text(0.42, y + h / 2, name, fontsize=7.5, weight="bold", color=NAVY,
                rotation=90, ha="center", va="center")

    # actors
    box(ax, 0.8, 7.55, 2.5, 0.8, "Developer\n(mints batches)", NAVY, fs=8.5)
    box(ax, 3.6, 7.55, 2.5, 0.8, "Verifier\n(stakes, attests)", NAVY, fs=8.5)
    box(ax, 6.4, 7.55, 2.5, 0.8, "Buyer / holder\n(trades, retires)", NAVY, fs=8.5)
    box(ax, 9.2, 7.55, 2.7, 0.8, "Regulator panel\n(3-of-5 owners)", NAVY, fs=8.5)

    # presentation
    box(ax, 0.8, 5.95, 3.4, 0.9, "React + Vite DApp\n(ethers.js, no backend)", TEAL, fs=8.5)
    box(ax, 4.6, 5.95, 3.4, 0.9, "MetaMask / EIP-1193\n(wallet, signing)", TEAL, fs=8.5)
    box(ax, 8.4, 5.95, 3.5, 0.9, "Six contract panels\nErrorBanner + diagnostics", TEAL, fs=8.5)

    # contracts - row 1
    box(ax, 0.55, 4.15, 3.55, 1.1,
        "CreditToken\nERC-20 + batch ledger, splitBatch,\nflag/freeze, optional MRV gate\n"
        "Marketplace moves it; Retire burns it", GREEN, fs=7.5)
    box(ax, 4.4, 4.15, 3.55, 1.1,
        "Marketplace\nlist / cancel / reprice / buyTokens\n"
        "credits move via CreditToken.transferFrom", GREEN, fs=7.5)
    box(ax, 8.25, 4.15, 3.6, 1.1,
        "RetireAndCertify\nburn + soulbound ERC-721 certificate\n"
        "burn via CreditToken.retireBatchFrom", GREEN, fs=7.5)

    # contracts - row 2
    box(ax, 0.55, 2.7, 3.55, 1.1,
        "VerifierStake\nstake, challenge windows, slash\nper-batch pro-rata compensation\n"
        "flags the batch on CreditToken", GREEN, fs=7.5)
    box(ax, 4.4, 2.7, 3.55, 1.1,
        "RegulatorMultisig\n3-of-5 propose + approve\nholds REGULATOR_ROLE\n"
        "executes VerifierStake.resolveChallenge", GREEN, fs=7.5)
    box(ax, 8.25, 2.7, 3.6, 1.1,
        "MockMRVOracle\nimplements IMRVOracle (settable)\nCreditToken.mintBatch reads its\n"
        "approval + evidence attestation", GREEN, fs=7.5)

    # off-chain components
    box(ax, 0.8, 0.55, 2.6, 1.25,
        "IPFS\nproject & challenge evidence\n(only hashes on chain)", AMBER, tc="#3a2f00", fs=8)
    box(ax, 3.7, 0.55, 2.6, 1.25,
        "MRV source\nsatellite / sensors / registry\n(adapter; mock in this build)", AMBER, tc="#3a2f00", fs=8)
    box(ax, 6.6, 0.55, 2.5, 1.25,
        "Hardhat node\nlocal chain, automine\ndeploy + role wiring", AMBER, tc="#3a2f00", fs=8)
    box(ax, 9.4, 0.55, 2.5, 1.25,
        "k6 harness\nsweep, stress, spike,\nendurance, staking", AMBER, tc="#3a2f00", fs=8)

    for x in (2.05, 4.85, 7.65, 10.55):
        arrow(ax, x, 7.55, x, 6.85)
    for x in (2.5, 6.3, 10.15):
        arrow(ax, x, 5.95, x, 5.25)

    ax.text(6.2, 2.42,
            "Only hashes and attestations cross the chain boundary. The frontend reads and writes "
            "these contracts through the wallet; there is no application server or database tier.",
            ha="center", fontsize=7.2, style="italic", color="#4b5563")

    fig.savefig(os.path.join(OUT, "da3_architecture.png"), dpi=160, bbox_inches="tight")
    plt.close(fig)


if __name__ == "__main__":
    architecture(); workflow(); sequence(); gantt(); novelty(); da3_architecture()
    print("Diagrams written to", OUT)
    # ponytail: quick self-check that all PNGs exist and are non-empty
    for f in ("architecture", "workflow", "sequence", "gantt", "novelty", "da3_architecture"):
        p = os.path.join(OUT, f + ".png")
        assert os.path.getsize(p) > 1000, f"{f}.png missing/too small"
    print("self-check OK")
