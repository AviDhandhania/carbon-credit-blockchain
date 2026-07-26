"""Build DA1_Report.docx and DA1_Presentation.pptx from fixed content + diagram PNGs.
Run: python build_deliverables.py
"""
import os
from docx import Document
from docx.shared import Pt, Inches, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from pptx import Presentation
from pptx.util import Inches as PInches, Pt as PPt
from pptx.dml.color import RGBColor as PRGB
from pptx.enum.text import PP_ALIGN

ROOT = os.path.dirname(os.path.abspath(__file__))
DIAG = os.path.join(ROOT, "diagrams")
NAVY = RGBColor(0x1f, 0x3a, 0x5f)
TEAL = RGBColor(0x2a, 0x9d, 0x8f)
PNAVY, PTEAL, PWHITE, PDARK = PRGB(0x1f, 0x3a, 0x5f), PRGB(0x2a, 0x9d, 0x8f), PRGB(0xff, 0xff, 0xff), PRGB(0x22, 0x22, 0x22)

def img(name):  # diagram path
    return os.path.join(DIAG, name)

# =====================================================================  DOCX
def build_docx():
    d = Document()
    st = d.styles["Normal"]; st.font.name = "Calibri"; st.font.size = Pt(11)

    def h(text, level, color=NAVY):
        p = d.add_heading(text, level)
        for r in p.runs: r.font.color.rgb = color
        return p

    def para(text, bold=False, italic=False, size=11):
        p = d.add_paragraph()
        r = p.add_run(text); r.bold = bold; r.italic = italic; r.font.size = Pt(size)
        return p

    def bullets(items):
        for it in items:
            p = d.add_paragraph(style="List Bullet"); p.add_run(it)

    def table(headers, rows):
        t = d.add_table(rows=1, cols=len(headers)); t.style = "Light Grid Accent 1"
        for i, hd in enumerate(headers):
            c = t.rows[0].cells[i]; c.text = ""
            r = c.paragraphs[0].add_run(hd); r.bold = True; r.font.size = Pt(10)
        for row in rows:
            cells = t.add_row().cells
            for i, val in enumerate(row):
                cells[i].text = ""; r = cells[i].paragraphs[0].add_run(str(val)); r.font.size = Pt(9.5)
        return t

    # Title page
    t = d.add_paragraph(); t.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r = t.add_run("Blockchain-Based Carbon Credit Trading System"); r.bold = True; r.font.size = Pt(24); r.font.color.rgb = NAVY
    s = d.add_paragraph(); s.alignment = WD_ALIGN_PARAGRAPH.CENTER
    rs = s.add_run("Digital Assignment 1 (DA1) — Blockchain Technology"); rs.font.size = Pt(14); rs.italic = True
    sg = d.add_paragraph(); sg.alignment = WD_ALIGN_PARAGRAPH.CENTER
    rg = sg.add_run("SDG 13 — Climate Action  |  Supporting SDG 7 & SDG 12"); rg.font.size = Pt(12); rg.font.color.rgb = TEAL; rg.bold = True
    d.add_paragraph()

    # 1
    h("1. Problem Statement, Objectives, and Scope", 1)
    h("1.1 Problem Statement", 2)
    para("Carbon credits are a market-based instrument to fight climate change: one credit represents the right to emit "
         "one tonne of CO2, and organisations that cut emissions can sell surplus credits to those exceeding their limits. "
         "In practice the market is undermined by four structural failures:")
    bullets([
        "Double-counting - the same credit is sold to multiple buyers because registries are siloed and never reconcile.",
        "Opacity - buyers, regulators and the public cannot verify that a credit is genuine or that the green project delivered.",
        "Fraud & 'phantom credits' - credits issued for projects that never existed or overstate impact, with no tamper-proof record.",
        "Slow, costly verification - manual, paper-based intermediaries take weeks to months and inflate cost.",
    ])
    para("These failures erode trust in the mechanism meant to accelerate climate action, letting continued emissions be "
         "'offset' by credits that deliver no real environmental benefit.")

    h("1.2 Objectives", 2)
    bullets([
        "O1. Tokenise carbon credits as unique, non-duplicable digital assets, each with a single traceable identity.",
        "O2. Automate issuance, transfer and permanent retirement (burning) via smart contracts, eliminating double-counting by design.",
        "O3. Provide a transparent, immutable, publicly auditable ledger of every credit's full lifecycle.",
        "O4. Reduce dependence on intermediaries, lowering verification time and transaction cost.",
        "O5. Enforce role-based authorisation (developer, verifier, buyer, regulator) so only legitimate actors issue or approve credits.",
    ])

    h("1.3 Scope", 2)
    para("In scope: ", bold=True); d.paragraphs[-1].add_run(
        "a decentralised application (DApp) on Ethereum; an ERC-20 token for fungible credits; a marketplace contract for "
        "listing/buying; a retirement contract for permanent burning; role-based access control; IPFS storage for project "
        "documents; and a public verification dashboard.")
    para("Out of scope (DA1): ", bold=True); d.paragraphs[-1].add_run(
        "live integration with government registries, legally binding settlement, real-money on-ramps, and ML-based impact "
        "estimation. DA1 covers problem framing, literature, blockchain justification, architecture and project plan - not implementation.")

    h("1.4 SDG Alignment", 2)
    table(["SDG", "Contribution"], [
        ["SDG 13 - Climate Action (primary)", "Restores integrity to carbon markets so offsets fund real emission reductions."],
        ["SDG 7 - Affordable & Clean Energy", "Renewable-energy credits gain a trustworthy, tradable value."],
        ["SDG 12 - Responsible Consumption", "Transparent tracking discourages greenwashing and rewards sustainable producers."],
    ])

    # 2
    h("2. Literature Survey and Research Gap", 1)
    h("2.1 Survey of Existing Work", 2)
    table(["Work / System", "Contribution", "Limitation"], [
        ["Toucan Protocol", "Bridges off-chain credits onto Ethereum; on-chain retirement.", "Trusts the off-chain bridge; tokenised low-quality legacy credits."],
        ["KlimaDAO", "Uses tokenised credits as a treasury asset to raise carbon price.", "Speculative/financial focus, not verification integrity."],
        ["IBM & Energy Web pilots", "Enterprise permissioned blockchain for emissions tracking.", "Not publicly auditable; consortium-only."],
        ["Verra / Gold Standard", "Established methodologies and human verification.", "Centralised, siloed; double-counting and slow settlement persist."],
        ["Academic surveys 2019-23", "Propose smart-contract trading; prove feasibility.", "Mostly conceptual; rarely model the full mint-trade-retire lifecycle."],
        ["EU ETS / economic models", "Model emission-trading schemes economically.", "Do not address the technical trust layer."],
    ])
    h("2.2 Identified Research Gap", 2)
    bullets([
        "G1 - Fragmented lifecycle: few solutions enforce the entire lifecycle (a credit cannot be sold after retirement).",
        "G2 - Weak off-chain/on-chain trust anchoring: bridged credits inherit legacy-registry flaws; verifier attestations and IPFS evidence are rarely bound to each token.",
        "G3 - Missing role-based governance on a public chain: transparency and strict on-chain role control seldom coexist.",
    ])
    para("This project addresses G1-G3 by designing one public-Ethereum system that enforces the full lifecycle in contract "
         "logic, anchors verifier attestations and IPFS hashes to every token, and layers role-based access control over a "
         "fully transparent ledger.", bold=True)

    # 3
    h("3. Blockchain Suitability - Why Ethereum?", 1)
    h("3.1 Is blockchain even needed?", 2)
    para("Blockchain is justified only when multiple non-trusting parties share data, no single authority should control it, "
         "an immutable audit trail is required, and disintermediation adds value. Carbon trading satisfies all four: "
         "polluters, developers, verifiers, regulators and the public do not fully trust each other; the record must be "
         "tamper-proof; and removing slow intermediaries is a core objective. A single-registry database is exactly the "
         "status quo that failed.")
    h("3.2 Ethereum vs Hyperledger Fabric", 2)
    table(["Criterion", "Ethereum (public)", "Hyperledger Fabric (permissioned)"], [
        ["Access", "Permissionless - anyone can verify", "Permissioned - invited members only"],
        ["Public auditability", "Full (essential here)", "Limited to consortium"],
        ["Native tokenisation", "First-class (ERC-20/721)", "Requires custom chaincode"],
        ["Trust model", "Trustless, decentralised", "Trust among known members"],
        ["Cost", "Gas fees (mitigable via L2)", "No gas, but infra cost"],
        ["Throughput", "Lower on L1, high on L2", "High"],
    ])
    h("3.3 Decision: Ethereum", 2)
    bullets([
        "Public verifiability matches the goal of exposing fraud and double-counting to anyone.",
        "Mature ERC-20/721 standards map directly onto 'one credit = one non-duplicable token'.",
        "Largest smart-contract ecosystem (Solidity, OpenZeppelin, MetaMask, testnets) speeds and hardens development.",
        "Layer-2 scaling (Polygon, Arbitrum) neutralises the gas-cost objection for production.",
    ])
    para("Hyperledger would be preferable only if credits were traded privately among a fixed, known set of corporations - "
         "which contradicts the public-accountability objective of this project.", italic=True)

    # 4
    h("4. System Architecture, Workflow, and Design", 1)
    h("4.1 System Architecture (four layers)", 2)
    bullets([
        "Presentation Layer - React web DApp, MetaMask wallet, verifier/regulator dashboard.",
        "Application/API Layer - Node.js REST API, auth & role manager, off-chain oracle adapter.",
        "Blockchain Layer (Ethereum) - CreditToken (ERC-20), Marketplace, Retirement/Burn contracts.",
        "Storage Layer - on-chain ledger, IPFS for documents (hash on-chain), off-chain DB cache.",
    ])
    d.add_picture(img("architecture.png"), width=Inches(6.3))
    h("4.2 Workflow - Carbon Credit Lifecycle", 2)
    para("Register green project -> verifier approves (attestation + IPFS hash anchored) -> credits minted as tokens -> "
         "company buys credits -> company retires/burns credits -> permanent public audit trail. A retired credit can "
         "never be resold, structurally eliminating double-counting.")
    d.add_picture(img("workflow.png"), width=Inches(6.3))
    h("4.3 Sequence - Buy & Retire a Credit", 2)
    d.add_picture(img("sequence.png"), width=Inches(6.0))
    h("4.4 Key Design Decisions", 2)
    bullets([
        "ERC-20 for fungible credits; optional ERC-721 to bind a unique project identity + metadata.",
        "OpenZeppelin AccessControl for the four roles.",
        "IPFS content-addressing keeps large files off-chain while the hash guarantees integrity on-chain.",
        "Retirement = irreversible burn, enforced in contract logic so double-spend is impossible.",
    ])

    # 5
    h("5. Project Planning - Timeline, Milestones, Feasibility", 1)
    h("5.1 Timeline & Milestones", 2)
    table(["Phase", "Weeks", "Milestone / Deliverable"], [
        ["Requirement analysis & literature survey", "W0-W2", "Finalised problem statement & survey (DA1)"],
        ["System design & architecture", "W1-W3", "Architecture + design diagrams (DA1)"],
        ["Smart-contract development (Solidity)", "W3-W6", "Deployed CreditToken, Marketplace, Retirement"],
        ["Frontend DApp + Web3 integration", "W4-W7", "Working DApp connected to MetaMask"],
        ["Oracle / IPFS integration", "W6-W8", "Off-chain evidence anchored on-chain"],
        ["Testing on testnet (Sepolia)", "W7-W9", "End-to-end lifecycle demo"],
        ["Security audit & gas optimisation", "W9-W10", "Audit report, optimised contracts"],
        ["Documentation & final demo", "W9-W11", "Final report + presentation"],
    ])
    d.add_picture(img("gantt.png"), width=Inches(6.3))
    h("5.2 Feasibility Analysis", 2)
    bullets([
        "Technical - High. Mature open-source stack: Solidity + OpenZeppelin, Hardhat, React + Web3.js, MetaMask, Sepolia, IPFS.",
        "Economic - High. Free testnets and open-source tooling; production gas mitigated via Layer-2.",
        "Operational - Medium. Needs accredited verifiers and regulator buy-in; complements existing registries.",
        "Schedule - High. The 11-week plan fits a single semester with incremental milestones.",
    ])
    h("5.3 Risks & Mitigation", 2)
    table(["Risk", "Mitigation"], [
        ["Off-chain data falsified before minting ('garbage in')", "Multiple independent verifier attestations; IPFS-anchored evidence."],
        ["High L1 gas fees", "Deploy on Layer-2; batch operations."],
        ["Smart-contract vulnerabilities", "Audited OpenZeppelin libraries; Slither static analysis + testnet audit."],
        ["Regulatory acceptance", "Position as interoperable transparency layer over existing registries."],
    ])

    h("References (indicative)", 1)
    for i, ref in enumerate([
        "Toucan Protocol - Bridging carbon credits on-chain (documentation).",
        "KlimaDAO - Tokenised carbon as a reserve asset (whitepaper).",
        "IBM & Energy Web Foundation - Enterprise carbon-tracking pilots.",
        "Verra & Gold Standard - Carbon credit verification methodologies.",
        "Survey papers on Blockchain for carbon emission trading, IEEE/Elsevier, 2019-2023.",
        "OpenZeppelin - ERC-20 and AccessControl contract libraries.",
    ], 1):
        p = d.add_paragraph(style="List Number"); p.add_run(ref)

    out = os.path.join(ROOT, "docs", "DA1_Report.docx")
    d.save(out); return out

# =====================================================================  PPTX
def build_pptx():
    prs = Presentation(); prs.slide_width = PInches(13.333); prs.slide_height = PInches(7.5)
    BLANK = prs.slide_layouts[6]
    W, H = prs.slide_width, prs.slide_height

    def bg(slide, color):
        slide.background.fill.solid(); slide.background.fill.fore_color.rgb = color

    def textbox(slide, l, t, w, h, text, size, color=PDARK, bold=False, align=PP_ALIGN.LEFT, italic=False):
        tb = slide.shapes.add_textbox(PInches(l), PInches(t), PInches(w), PInches(h))
        tf = tb.text_frame; tf.word_wrap = True
        p = tf.paragraphs[0]; p.alignment = align
        r = p.add_run(); r.text = text; f = r.font
        f.size = PPt(size); f.bold = bold; f.italic = italic; f.color.rgb = color; f.name = "Calibri"
        return tb

    def bullets_slide(title, items, subtitle=None):
        s = prs.slides.add_slide(BLANK); bg(s, PWHITE)
        # header band
        band = s.shapes.add_shape(1, 0, 0, W, PInches(1.15)); band.fill.solid()
        band.fill.fore_color.rgb = PNAVY; band.line.fill.background()
        textbox(s, 0.5, 0.22, 12.3, 0.8, title, 28, PWHITE, bold=True)
        if subtitle:
            textbox(s, 0.5, 1.25, 12.3, 0.5, subtitle, 15, PTEAL, italic=True)
        top = 2.0 if subtitle else 1.5
        tb = s.shapes.add_textbox(PInches(0.7), PInches(top), PInches(12), PInches(5.2))
        tf = tb.text_frame; tf.word_wrap = True
        for i, it in enumerate(items):
            p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
            r = p.add_run(); r.text = "•  " + it
            r.font.size = PPt(18); r.font.color.rgb = PDARK; r.font.name = "Calibri"
            p.space_after = PPt(10)
        return s

    def image_slide(title, image, subtitle=None):
        s = prs.slides.add_slide(BLANK); bg(s, PWHITE)
        band = s.shapes.add_shape(1, 0, 0, W, PInches(1.0)); band.fill.solid()
        band.fill.fore_color.rgb = PNAVY; band.line.fill.background()
        textbox(s, 0.5, 0.18, 12.3, 0.7, title, 26, PWHITE, bold=True)
        from PIL import Image
        iw, ih = Image.open(image).size
        maxw, maxh = 11.5, 5.6
        ratio = min(maxw / (iw / 150), maxh / (ih / 150))
        dw, dh = (iw / 150) * ratio, (ih / 150) * ratio
        s.shapes.add_picture(image, PInches((13.333 - dw) / 2), PInches(1.2), PInches(dw), PInches(dh))
        return s

    # Title slide
    s = prs.slides.add_slide(BLANK); bg(s, PNAVY)
    textbox(s, 0.8, 2.2, 11.7, 1.6, "Blockchain-Based Carbon Credit Trading System", 40, PWHITE, bold=True, align=PP_ALIGN.CENTER)
    textbox(s, 0.8, 3.9, 11.7, 0.7, "Digital Assignment 1 (DA1)  •  Blockchain Technology", 20, PRGB(0xcf,0xe3,0xdf), align=PP_ALIGN.CENTER)
    textbox(s, 0.8, 4.7, 11.7, 0.7, "SDG 13 — Climate Action   |   Supporting SDG 7 & SDG 12", 18, PTEAL, bold=True, align=PP_ALIGN.CENTER)

    # Agenda
    bullets_slide("Agenda", [
        "Problem Statement, Objectives & Scope (SDG 13)",
        "Literature Survey & Research Gap",
        "Blockchain Suitability — Why Ethereum?",
        "System Architecture, Workflow & Design",
        "Project Planning — Timeline, Milestones, Feasibility",
    ])

    # 1 Problem
    bullets_slide("1. Problem Statement", [
        "Carbon credit = right to emit 1 tonne CO2; surplus credits are traded to reward decarbonisation.",
        "Double-counting — same credit sold to multiple buyers across siloed registries.",
        "Opacity — no one can independently verify a credit or its underlying green project.",
        "Fraud & 'phantom credits' — credits for projects that never existed / overstated impact.",
        "Slow, costly manual verification via intermediaries.",
    ], subtitle="The carbon market meant to fight climate change is undermined by four structural failures")
    bullets_slide("1. Objectives & Scope", [
        "O1: Tokenise credits as unique, non-duplicable assets.",
        "O2: Automate mint / transfer / retire via smart contracts — no double-counting by design.",
        "O3: Transparent, immutable, publicly auditable lifecycle ledger.",
        "O4: Cut intermediaries → faster, cheaper verification.",
        "O5: Role-based authorisation (developer / verifier / buyer / regulator).",
        "Scope (DA1): design DApp, ERC-20 credits, marketplace + retirement contracts, IPFS, dashboard — not implementation.",
    ], subtitle="SDG 13 Climate Action (primary), supporting SDG 7 & SDG 12")

    # 2 Literature
    bullets_slide("2. Literature Survey", [
        "Toucan Protocol — bridges credits on-chain; trusts the off-chain bridge.",
        "KlimaDAO — tokenised credits as treasury asset; speculative focus.",
        "IBM / Energy Web — permissioned tracking; not publicly auditable.",
        "Verra / Gold Standard — solid methodology but centralised & siloed.",
        "Academic surveys (2019-23) — mostly conceptual; rarely model full lifecycle.",
    ])
    bullets_slide("2. Research Gap", [
        "G1 — Fragmented lifecycle: few enforce 'cannot sell after retirement'.",
        "G2 — Weak trust anchoring: bridged credits inherit legacy flaws; evidence not bound to token.",
        "G3 — Missing role-based governance on a public chain.",
        "This project: one public-Ethereum system enforcing the full lifecycle, anchoring verifier attestations + IPFS hashes, with role-based access control.",
    ], subtitle="What the literature leaves unsolved")

    # 3 Blockchain suitability
    bullets_slide("3. Why Blockchain? Why Ethereum?", [
        "Blockchain fits when: multiple non-trusting parties, no single authority, immutable audit trail, disintermediation adds value — carbon trading meets all four.",
        "Public verifiability by regulators & the public → rules out permissioned Hyperledger.",
        "ERC-20 / ERC-721 map directly onto 'one credit = one non-duplicable token'.",
        "Largest ecosystem: Solidity, OpenZeppelin, MetaMask, testnets → faster, safer build.",
        "Layer-2 (Polygon/Arbitrum) neutralises gas-cost objection.",
    ], subtitle="Public Ethereum chosen over permissioned Hyperledger Fabric")

    # 4 Architecture + diagrams
    image_slide("4. System Architecture", img("architecture.png"))
    image_slide("4. Carbon Credit Lifecycle Workflow", img("workflow.png"))
    image_slide("4. Sequence — Buy & Retire", img("sequence.png"))

    # 5 Planning
    image_slide("5. Project Plan — Gantt Chart", img("gantt.png"))
    bullets_slide("5. Feasibility", [
        "Technical — HIGH: mature open-source stack (Solidity, OpenZeppelin, Hardhat, React, MetaMask, IPFS).",
        "Economic — HIGH: free testnets & tooling; production gas cut via Layer-2.",
        "Operational — MEDIUM: needs verifier & regulator buy-in; complements existing registries.",
        "Schedule — HIGH: 11-week plan fits one semester.",
        "Key risk: 'garbage-in' off-chain data → mitigated by multiple attestations + IPFS evidence.",
    ])

    # Closing
    s = prs.slides.add_slide(BLANK); bg(s, PNAVY)
    textbox(s, 0.8, 2.6, 11.7, 1.2, "Thank You", 44, PWHITE, bold=True, align=PP_ALIGN.CENTER)
    textbox(s, 0.8, 4.0, 11.7, 0.7, "Restoring trust in carbon markets, one immutable credit at a time.", 18, PTEAL, italic=True, align=PP_ALIGN.CENTER)

    out = os.path.join(ROOT, "presentation", "DA1_Presentation.pptx")
    prs.save(out); return out

if __name__ == "__main__":
    print("DOCX:", build_docx())
    print("PPTX:", build_pptx())
