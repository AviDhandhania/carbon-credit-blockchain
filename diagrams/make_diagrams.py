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
    fig, ax = plt.subplots(figsize=(11, 7.5))
    ax.set_xlim(0, 12); ax.set_ylim(0, 10); ax.axis("off")
    ax.text(6, 9.6, "System Architecture — Blockchain Carbon Credit Trading",
            ha="center", fontsize=14, weight="bold", color=NAVY)

    # Layer bands
    layers = [("Presentation Layer", 8.0, "#eef2f7"),
              ("Application / API Layer", 5.6, "#e6f4f1"),
              ("Blockchain Layer (Ethereum)", 3.0, "#e8f5e9"),
              ("Storage Layer", 0.6, "#fff5e0")]
    for name, y, c in layers:
        ax.add_patch(FancyBboxPatch((0.3, y), 11.4, 1.9, boxstyle="round,pad=0.02",
                                    fc=c, ec=GREY, lw=1))
        ax.text(0.55, y + 1.7, name, fontsize=9, weight="bold", color=NAVY)

    # Presentation
    box(ax, 1.0, 8.3, 2.6, 1.2, "Web DApp\n(React + Web3.js)", NAVY)
    box(ax, 4.4, 8.3, 2.6, 1.2, "MetaMask\nWallet", NAVY)
    box(ax, 7.8, 8.3, 3.4, 1.2, "Verifier / Regulator\nDashboard", NAVY)
    # Application
    box(ax, 1.0, 5.9, 3.0, 1.2, "REST API\n(Node.js/Express)", TEAL)
    box(ax, 4.6, 5.9, 3.0, 1.2, "Auth &\nRole Manager", TEAL)
    box(ax, 8.2, 5.9, 3.0, 1.2, "Off-chain\nOracle Adapter", TEAL)
    # Blockchain
    box(ax, 1.0, 3.3, 3.0, 1.2, "CreditToken\n(ERC-20)", GREEN)
    box(ax, 4.6, 3.3, 3.0, 1.2, "Marketplace\nSmart Contract", GREEN)
    box(ax, 8.2, 3.3, 3.0, 1.2, "Retirement /\nBurn Contract", GREEN)
    # Storage
    box(ax, 1.0, 0.85, 3.0, 1.2, "On-chain Ledger\n(Tx history)", AMBER, tc="#3a2f00")
    box(ax, 4.6, 0.85, 3.0, 1.2, "IPFS\n(Project docs)", AMBER, tc="#3a2f00")
    box(ax, 8.2, 0.85, 3.0, 1.2, "Off-chain DB\n(Metadata cache)", AMBER, tc="#3a2f00")

    for x in (2.5, 6.1, 9.7):
        arrow(ax, x, 8.3, x, 7.1)   # presentation -> app
        arrow(ax, x, 5.9, x, 4.5)   # app -> blockchain
        arrow(ax, x, 3.3, x, 2.05)  # blockchain -> storage
    fig.savefig(os.path.join(OUT, "architecture.png"), dpi=150, bbox_inches="tight")
    plt.close(fig)

# ---------------------------------------------------------------- WORKFLOW
def workflow():
    fig, ax = plt.subplots(figsize=(11, 5))
    ax.set_xlim(0, 12); ax.set_ylim(0, 5); ax.axis("off")
    ax.text(6, 4.6, "Carbon Credit Lifecycle Workflow", ha="center",
            fontsize=14, weight="bold", color=NAVY)
    steps = [("1. Green project\nregistered", NAVY),
             ("2. Verifier\napproves", TEAL),
             ("3. Credits\nminted (tokens)", GREEN),
             ("4. Company\nbuys credits", GREEN),
             ("5. Credits\nretired / burned", AMBER),
             ("6. Public\naudit trail", NAVY)]
    x = 0.4; w = 1.75; gap = 0.15; y = 2.2
    for i, (t, c) in enumerate(steps):
        tc = "#3a2f00" if c == AMBER else "white"
        box(ax, x, y, w, 1.3, t, c, tc=tc, fs=9)
        if i < len(steps) - 1:
            arrow(ax, x + w, y + 0.65, x + w + gap, y + 0.65)
        x += w + gap
    ax.text(6, 0.9, "No double-counting: once retired, a credit can never be resold.",
            ha="center", fontsize=9, style="italic", color="#555")
    fig.savefig(os.path.join(OUT, "workflow.png"), dpi=150, bbox_inches="tight")
    plt.close(fig)

# ---------------------------------------------------------------- SEQUENCE
def sequence():
    fig, ax = plt.subplots(figsize=(11, 6.5))
    ax.set_xlim(0, 12); ax.set_ylim(0, 10); ax.axis("off")
    ax.text(6, 9.6, "Sequence Diagram — Buy & Retire a Carbon Credit",
            ha="center", fontsize=13, weight="bold", color=NAVY)
    actors = [("Buyer\n(Company)", 1.5), ("Web DApp", 4.0),
              ("Marketplace\nContract", 7.0), ("Ethereum\nBlockchain", 10.0)]
    for name, x in actors:
        box(ax, x - 1.0, 8.3, 2.0, 0.9, name, NAVY, fs=9)
        ax.plot([x, x], [0.5, 8.3], color=GREY, ls="--", lw=1)
    msgs = [(1.5, 4.0, "1: connect wallet + select credit", 7.6),
            (4.0, 7.0, "2: buyCredit(id, qty)", 6.7),
            (7.0, 10.0, "3: transfer tokens, record tx", 5.8),
            (10.0, 7.0, "4: tx confirmed (hash)", 4.9),
            (7.0, 1.5, "5: ownership updated", 4.0),
            (1.5, 7.0, "6: retire(id)", 3.1),
            (7.0, 10.0, "7: burn tokens (permanent)", 2.2),
            (10.0, 1.5, "8: audit-proof receipt", 1.3)]
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
        ("Oracle / IPFS integration", 6, 2, GREEN),
        ("Testing on testnet (Sepolia)", 7, 2, AMBER),
        ("Security audit & gas optimization", 9, 1, AMBER),
        ("Documentation & final demo", 9, 2, NAVY),
    ]
    for i, (name, start, dur, c) in enumerate(tasks):
        y = len(tasks) - i
        ax.barh(y, dur, left=start, height=0.55, color=c, edgecolor="#0d1b2a")
        ax.text(start + dur / 2, y, name, ha="center", va="center",
                color="white" if c != AMBER else "#3a2f00", fontsize=8, weight="bold")
    ax.set_yticks([]); ax.set_xlim(0, 11)
    ax.set_xticks(range(0, 12))
    ax.set_xticklabels([f"W{i}" for i in range(0, 12)], fontsize=9)
    ax.set_xlabel("Project Timeline (Weeks)", fontsize=10, weight="bold")
    ax.set_title("Project Plan — Gantt Chart", fontsize=13, weight="bold", color=NAVY)
    ax.grid(axis="x", ls=":", alpha=0.5)
    fig.savefig(os.path.join(OUT, "gantt.png"), dpi=150, bbox_inches="tight")
    plt.close(fig)

if __name__ == "__main__":
    architecture(); workflow(); sequence(); gantt()
    print("Diagrams written to", OUT)
    # ponytail: quick self-check that all 4 PNGs exist and are non-empty
    for f in ("architecture", "workflow", "sequence", "gantt"):
        p = os.path.join(OUT, f + ".png")
        assert os.path.getsize(p) > 1000, f"{f}.png missing/too small"
    print("self-check OK")
