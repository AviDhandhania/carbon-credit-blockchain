# 5-Minute Demo Script — Carbon Credit Trading System (DA2 + DA3)

**Total time: 5:00** · Presenter runs the app live in two browser windows: the dApp (`localhost:3000`) and MetaMask.

---

## Before you start (do these 10 minutes BEFORE the demo, not live)

1. Terminal 1: `npx hardhat node` — starts my **own local Hardhat blockchain server** on `http://127.0.0.1:8545` (chain ID `31337`). This is my own local Ethereum node, not a public network, so every transaction is instant and free.
2. Terminal 2: `npx hardhat run scripts/deploy.js --network localhost` — deploys the 6 smart contracts to that local node and wires up all roles.
   > If you want to demo the **old single-key** resolve flow instead of the panel, add `KEEP_DEPLOYER_REGULATOR=true` to this command.
3. Terminal 3: `cd frontend && npm run dev` — serves the React dApp on `localhost:3000`.
4. In MetaMask: switch network to **Localhost 8545** and import the Hardhat test account (the one ending `…2266`, funded with 10000 test ETH) so it is available for signing.
5. Leave the Hardhat terminal visible in a corner of the screen — I point at it to prove the chain is real.

> **Talking point:** "I ran my own Ethereum node locally with Hardhat and connected the frontend to it via MetaMask, so the whole demo — minting, trading, retiring, staking — executes as real signed transactions on a real EVM chain, just on my machine."

---

## 0:00 – 0:45 · Introduction & Problem

**On screen:** Landing page of the app + MetaMask.

> "Hi, I'm demonstrating my Digital Assignment 2 build: a **blockchain-based carbon credit trading system**.
> The problem it solves: carbon credits today sit in siloed, private registries. A buyer cannot verify a credit was genuinely issued, cannot trust the verifier who approved it, and cannot prove the credit was actually retired. There have been real cases of credits being sold twice.
>
> My system makes issuance, trading and retirement all **transparent, auditable and irreversible** on-chain. This submission is the **50% milestone** the assignment asked for, and I'm going to walk you through all four working modules in five minutes."

---

## 0:45 – 1:00 · Connect the wallet

**Do:** Click **Connect Wallet** in MetaMask / the app. The header updates to show the connected address.

**Say:**
> "The app talks to my local Hardhat node directly through **MetaMask** over ethers.js — no backend, no database. The green badge in the top-right of MetaMask shows **localhost:8545**, which is my own local chain. Every button in this app is a real transaction that I sign and that gets mined instantly on my node."

*Also mention:* the app has a **Switch to Localhost (Hardhat)** / **Switch to Sepolia** toggle, so the same frontend can point at a public testnet when the contracts are deployed there.

---

## 1:00 – 2:00 · Module 1 — Credit Token (ERC-20 issuance with per-batch tracking)

**Do:**
1. Under **Credit Token (ERC-20)**, enter Project ID `PROJ-001`, an IPFS hash for the project's methodology document, and Amount `1000` tonnes CO₂.
2. Click **Mint Batch** → confirm in MetaMask.
3. Point at the panel: **Total Supply** jumps to 1000 CC and **Your Balance** to 1000 CC.
4. Show the **Minted Batches** list showing Batch #1 with project ID, verifier, amount and IPFS hash.

**Say:**
> "Credits are an **ERC-20 token**, but each mint creates a **distinct tracked batch** rather than fungible units of one pool. For every batch the contract permanently records: which project it came from, which verifier approved it, how many tonnes, the IPFS hash of the supporting documents, and the timestamp.
>
> The critical design choice: the **document itself lives on IPFS** — only the hash goes on-chain. So the chain stays cheap, but the evidence is tamper-evident, and anyone — including a regulator or a journalist — can read the audit trail.
>
> Minting is restricted by **role-based access control**: only accounts with the Minter role can issue credits, so a random user cannot flood the market with fake credits."

*Optional flex (5 seconds):* show that minting from an unauthorised account reverts.

---

## 2:00 – 2:50 · Module 2 — Marketplace (buy & sell)

**Do:**
1. In **Create Listing**, enter Batch `1`, Amount `100`, Price `0.001` ETH per credit → **Create Listing**. Confirm the two MetaMask prompts (approve, then create listing).
2. The listing appears under **Your Listings** and in **Active Listings**.
3. Select the listing in the **Buy Credits** dropdown, enter `50` → **Buy Credits**. Approve + send `0.05 ETH`.
4. Point out balances: seller now has 900 credits, buyer has 50.

**Say:**
> "Credits trade on-chain. The standard ERC-20 **approve-then-transfer** pattern is used — you never hand over your tokens to a stranger's contract, the marketplace only gets permission to move what you approve.
>
> The important property for carbon markets is that **trading does not destroy the credit** — a credit that is sold is still owned by exactly one party, and the ledger keeps the full history of who held it and when. Retiring it later is what permanently removes it from circulation."

---

## 2:50 – 3:40 · Module 3 — Retire & Certify (soulbound certificates)

**Do:**
1. In **Retire Credits & Mint Certificate**, enter Batch `1`, Amount `100`, and an IPFS metadata URI → **Retire & Mint Certificate**.
2. Approve + confirm.
3. Show **Your Retirement Certificates (Soulbound)**: certificate #1 appears with 100 tonnes retired, batch, project and date.
4. Show the credit balance dropped by 100.

**Say:**
> "This is the heart of the system. **Retirement is a burn** — the tokens are destroyed on-chain, so a credit can never be double-counted or claimed twice. That irreversibility is enforced by the contract itself, not by trusting a registry operator.
>
> In exchange for burning, the user receives an **ERC-721 retirement certificate**. And this is the novel part: these certificates are **soulbound** — I disabled transfers, approvals and selling, so a certificate is permanent, non-transferable proof of the offset. You can't forge it, and you can't sell your claim to having offset emissions.
>
> The certificate metadata is an IPFS URI, so the full retirement document — methodology, tonnes, date, project — is retrievable forever."

---

## 3:40 – 4:40 · Module 4 — Verifier Stake & Challenge (the anti-fraud mechanism)

**Do:**
1. Under **Verifier Stake & Challenge**, deposit `1 ETH` → **Deposit Stake**. The header updates: Your Stake `1 ETH`, Status `Active`.
2. As the same account, create a **challenge** on Batch `1` with an evidence hash — note the `0.1 ETH` challenge bond shown on screen. Confirm in MetaMask.
3. Show the new entry under **All Challenges**.
4. Scroll to **Regulator Multisig (3-of-5)** → *Propose Resolution* → challenge `1`, **Challenger Wins**. Then approve it from **three separate MetaMask accounts**: hit *Approve*, switch account, repeat.
5. The resolution executes automatically on the **third** approval — the batch is flagged and the stake is slashed.
6. Optionally scroll to **Verifier Stake** → *Claim Buyer Compensation* → batch `1` to show the pro-rata pool. Switching to the account that was slashed and trying to claim is rejected on purpose.

> **Worth demonstrating on purpose:** try to resolve directly from the deployer account first. It reverts — because the deployer's own regulator role was revoked at deploy time in favour of the panel.

**Say:**
> "Anyone can approve carbon projects, which is exactly why the industry has integrity problems. So verifiers must **lock stake — here a minimum of 1 ETH — before they can approve a batch**. That stake is slashed if their approval turns out to be wrong.
>
> During a **90-day challenge window**, anyone can challenge an approval by posting a small 0.1 ETH bond and an IPFS evidence hash — so frivolous challenges cost money too.
>
> If a **panel** rules in the challenger's favour, the verifier's stake is **slashed: half to the challenger, half into a per-batch pool** that the buyers draw from pro-rata. That economic penalty is what makes honest verification self-enforcing.
>
> Crucially, **no single key can make that ruling.** The regulator role is held by a **3-of-5 multisig**, and the deployer's own single-key regulator power is revoked during deployment — so the party who deployed the system cannot unilaterally slash a verifier or wave a fraudulent batch through. Three separate owners have to agree, and the resolution fires automatically on the third approval.
>
> Notice the roles: verifier, challenger and regulator are all separate addresses in the contract. Nothing here is hard-coded to my account at runtime."

---

## 4:40 – 5:00 · Tests, what's done, and what's next

**On screen:** back to top of the app, or a second terminal.

**Say:**
> "To summarise: the scope is complete and **fully functional**, not mocked.
>
> ✅ CreditToken — ERC-20 with per-batch tracking, fractionalization, role-gated minting, retirement and flagging
> ✅ Marketplace — listings, purchases, price updates, cancellation
> ✅ RetireAndCertify — burn + soulbound non-transferable ERC-721 certificates
> ✅ VerifierStake — deposits, configurable per-batch challenge windows, per-batch pro-rata compensation, slashing
> ✅ RegulatorMultisig — 3-of-5 panel gates every challenge resolution
> ✅ MockMRVOracle — optional MRV attestation required before minting
> ✅ React + Vite frontend talking to my **own local Hardhat node** through MetaMask
> ✅ **106 automated tests passing** with `npx hardhat test`, covering happy paths, access control and revert cases
> ✅ A **25-assertion end-to-end check** driving the deployed contracts through the same ABIs the frontend uses, so a broken ABI can't hide until the browser
>
> Deliberately out of scope, and why: a public-network deployment needs funded keys and is irreversible, a fiat on/off-ramp needs a payments vendor and KYC, and a real satellite MRV feed needs an off-chain data provider. The on-chain interface for that last one is already in place, so it is an adapter away.
>
> The key takeaway: **the chain enforces the rules — irreversible retirement, soulbound proof, and stake that can be lost — so trust comes from the code, not from an institution. Thank you, I'm happy to take questions."

---

## Backup / Anticipated Questions

| Question | Answer |
|---|---|
| Why localhost and not a real network? | It's my own local Hardhat Ethereum node — a full EVM chain on my machine. It lets me demo deterministically and for free. The same frontend has a **Switch to Sepolia** button and the contracts are network-agnostic, so deployment to Sepolia is an address change. |
| How do you stop someone selling the same credit twice? | The token balance is the source of truth. A credit can only exist in one wallet at a time; retirement burns it so it leaves circulation permanently. |
| Can a certificate be transferred or hacked out? | No. `transfer`, `approve` and `setApprovalForAll` are overridden to revert on the certificate contract — soulbound. |
| Who controls the roles? | OpenZeppelin `AccessControl`. Only the admin can grant roles, and each contract has its own. In production the admin would be a multisig or a governance contract, not an EOA. |
| Why the challenge bond? | Without it, anyone could spam challenges and grief verifiers. The bond means only challenges backed by real evidence are worth filing. |
| Where are the documents stored? | IPFS. Only the hash is on-chain, which is cheap and tamper-evident. |

---

## Timing Summary

| Time | Segment |
|---|---|
| 0:00 – 0:45 | Intro & problem statement |
| 0:45 – 1:00 | MetaMask connect to local Hardhat node |
| 1:00 – 2:00 | Module 1: mint carbon credit batch |
| 2:00 – 2:50 | Module 2: list and buy credits |
| 2:50 – 3:40 | Module 3: retire + mint soulbound certificate |
| 3:40 – 4:40 | Module 4: verifier stake, challenge, slashing |
| 4:40 – 5:00 | Tests, 50% scope summary, future work, Q&A |
