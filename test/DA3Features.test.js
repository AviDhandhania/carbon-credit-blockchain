const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
require("@nomicfoundation/hardhat-chai-matchers");

const PROJECT_ID = "PROJ-001";
const IPFS_HASH = "QmTestHash123";
const ETH = ethers.parseEther;

describe("CreditToken: batch fractionalization", function () {
  let creditToken;
  let owner, verifier, buyer1;
  const INITIAL_AMOUNT = ethers.parseUnits("1000", 18);
  const SPLIT_AMOUNT = ethers.parseUnits("300", 18);

  beforeEach(async function () {
    [owner, verifier, buyer1] = await ethers.getSigners();

    const CreditToken = await ethers.getContractFactory("CreditToken");
    creditToken = await CreditToken.deploy(owner.address);
    await creditToken.waitForDeployment();

    await creditToken.grantMinterRole(verifier.address);
    await creditToken.connect(verifier).mintBatch(PROJECT_ID, IPFS_HASH, INITIAL_AMOUNT);
  });

  it("Should split a batch into a child batch without changing total supply", async function () {
    const childId = await creditToken.connect(verifier).splitBatch.staticCall(1, SPLIT_AMOUNT, "PROJ-001-A");
    await creditToken.connect(verifier).splitBatch(1, SPLIT_AMOUNT, "PROJ-001-A");
    expect(childId).to.equal(2);

    expect(await creditToken.getUserBatchBalance(2, verifier.address)).to.equal(SPLIT_AMOUNT);
    expect(await creditToken.getUserBatchBalance(1, verifier.address)).to.equal(INITIAL_AMOUNT - SPLIT_AMOUNT);

    // Fractionalization regroups ownership; it must not mint.
    expect(await creditToken.totalSupply()).to.equal(INITIAL_AMOUNT);
    expect(await creditToken.balanceOf(verifier.address)).to.equal(INITIAL_AMOUNT);
    expect(await creditToken.getBatchSupply(1)).to.equal(INITIAL_AMOUNT - SPLIT_AMOUNT);
    expect(await creditToken.getBatchSupply(2)).to.equal(SPLIT_AMOUNT);
  });

  it("Should preserve provenance on the child batch", async function () {
    await creditToken.connect(verifier).splitBatch(1, SPLIT_AMOUNT, "PROJ-001-A");

    const child = await creditToken.getBatchInfo(2);
    expect(child[0]).to.equal("PROJ-001-A");
    expect(child[1]).to.equal(verifier.address);
    expect(child[2]).to.equal(IPFS_HASH);
    expect(child[3]).to.equal(SPLIT_AMOUNT);
    expect(child[5]).to.be.false;
    expect(child[6]).to.be.false;

    expect(await creditToken.getBatchParent(2)).to.equal(1);
    expect(await creditToken.getBatchParent(1)).to.equal(0);
  });

  it("Should emit BatchSplit", async function () {
    await expect(creditToken.connect(verifier).splitBatch(1, SPLIT_AMOUNT, "PROJ-001-A"))
      .to.emit(creditToken, "BatchSplit")
      .withArgs(1, 2, verifier.address, SPLIT_AMOUNT);
  });

  it("Should revert when splitting more than the holder owns", async function () {
    await expect(creditToken.connect(verifier).splitBatch(1, INITIAL_AMOUNT + 1n, "PROJ-001-A"))
      .to.be.revertedWith("Insufficient batch balance");
  });

  it("Should revert when the holder owns nothing of the batch", async function () {
    await expect(creditToken.connect(buyer1).splitBatch(1, SPLIT_AMOUNT, "PROJ-001-A"))
      .to.be.revertedWith("Insufficient batch balance");
  });

  it("Should revert when splitting a flagged batch", async function () {
    await creditToken.flagBatch(1, true);
    await expect(creditToken.connect(verifier).splitBatch(1, SPLIT_AMOUNT, "PROJ-001-A"))
      .to.be.revertedWith("Batch is flagged");
  });

  it("Should freeze a flagged batch against transfers", async function () {
    await creditToken.flagBatch(1, true);
    await expect(creditToken.connect(verifier).transfer(buyer1.address, 1n))
      .to.be.revertedWith("Batch is flagged");
    await expect(creditToken.connect(verifier).transfer(buyer1.address, INITIAL_AMOUNT))
      .to.be.revertedWith("Batch is flagged");
  });

  it("Should allow transfers again once a batch is unflagged", async function () {
    await creditToken.flagBatch(1, true);
    await expect(creditToken.connect(verifier).transfer(buyer1.address, 1n))
      .to.be.revertedWith("Batch is flagged");

    await creditToken.flagBatch(1, false);
    await creditToken.connect(verifier).transfer(buyer1.address, ethers.parseUnits("10", 18));
    expect(await creditToken.getUserBatchBalance(1, buyer1.address))
      .to.equal(ethers.parseUnits("10", 18));
  });

  it("Should revert when splitting a fully retired batch", async function () {
    await creditToken.connect(verifier).retireBatch(1, INITIAL_AMOUNT);

    const info = await creditToken.getBatchInfo(1);
    expect(info[5]).to.be.true; // isRetired is now tracked

    await expect(creditToken.connect(verifier).splitBatch(1, 1n, "PROJ-001-A"))
      .to.be.revertedWith("Batch already fully retired");
  });

  it("Should revert on a zero amount or empty project id", async function () {
    await expect(creditToken.connect(verifier).splitBatch(1, 0, "PROJ-001-A"))
      .to.be.revertedWith("Amount must be > 0");
    await expect(creditToken.connect(verifier).splitBatch(1, SPLIT_AMOUNT, ""))
      .to.be.revertedWith("Project ID required");
  });

  it("Should revert when splitting a batch that does not exist", async function () {
    await expect(creditToken.connect(verifier).splitBatch(99, SPLIT_AMOUNT, "PROJ-001-A"))
      .to.be.revertedWith("Batch not found");
  });

  it("Should drop the parent from the holder's list after a full split", async function () {
    await creditToken.connect(verifier).splitBatch(1, INITIAL_AMOUNT, "PROJ-001-A");

    expect(await creditToken.getUserBatchBalance(1, verifier.address)).to.equal(0);
    expect(await creditToken.getBatchSupply(1)).to.equal(0);
    expect(await creditToken.getBatchSupply(2)).to.equal(INITIAL_AMOUNT);

    // The held child must still be spendable after the parent is dropped.
    await creditToken.connect(verifier).transfer(buyer1.address, SPLIT_AMOUNT / 2n);
    expect(await creditToken.getUserBatchBalance(2, buyer1.address)).to.equal(SPLIT_AMOUNT / 2n);
  });

  it("Should let a child batch be split again (multi-generation lineage)", async function () {
    await creditToken.connect(verifier).splitBatch(1, SPLIT_AMOUNT, "PROJ-001-A");
    await creditToken.connect(verifier).splitBatch(2, ethers.parseUnits("100", 18), "PROJ-001-A-1");

    expect(await creditToken.getBatchParent(3)).to.equal(2);
    expect(await creditToken.getBatchSupply(2)).to.equal(ethers.parseUnits("200", 18));
    expect(await creditToken.getBatchSupply(3)).to.equal(ethers.parseUnits("100", 18));
    expect(await creditToken.totalSupply()).to.equal(INITIAL_AMOUNT);
  });
});

describe("CreditToken: MRV oracle attestation", function () {
  let creditToken, oracle;
  let owner, verifier;
  const AMOUNT = ethers.parseUnits("1000", 18);

  beforeEach(async function () {
    [owner, verifier] = await ethers.getSigners();

    const CreditToken = await ethers.getContractFactory("CreditToken");
    creditToken = await CreditToken.deploy(owner.address);
    await creditToken.waitForDeployment();

    const MockMRVOracle = await ethers.getContractFactory("MockMRVOracle");
    oracle = await MockMRVOracle.deploy(owner.address);
    await oracle.waitForDeployment();

    await creditToken.grantMinterRole(verifier.address);
  });

  it("Should skip attestation entirely when no oracle is configured", async function () {
    await creditToken.connect(verifier).mintBatch(PROJECT_ID, IPFS_HASH, AMOUNT);
    expect(await creditToken.getBatchSupply(1)).to.equal(AMOUNT);
  });

  it("Should allow minting when the oracle approves the project", async function () {
    await creditToken.setMRVOracle(await oracle.getAddress());
    await oracle.attestProjectWithString(PROJECT_ID, IPFS_HASH, 1000, true);

    await creditToken.connect(verifier).mintBatch(PROJECT_ID, IPFS_HASH, AMOUNT);
    expect(await creditToken.getBatchSupply(1)).to.equal(AMOUNT);
  });

  it("Should revert when the oracle has not approved the project", async function () {
    await creditToken.setMRVOracle(await oracle.getAddress());

    await expect(creditToken.connect(verifier).mintBatch(PROJECT_ID, IPFS_HASH, AMOUNT))
      .to.be.revertedWith("Project not approved by MRV oracle");
  });

  it("Should revert when the hash does not match the oracle", async function () {
    await creditToken.setMRVOracle(await oracle.getAddress());
    await oracle.attestProjectWithString(PROJECT_ID, "QmSomeOtherHash", 1000, true);

    await expect(creditToken.connect(verifier).mintBatch(PROJECT_ID, IPFS_HASH, AMOUNT))
      .to.be.revertedWith("IPFS hash does not match MRV oracle");
  });

  it("Should revert when an approved project is later revoked", async function () {
    await creditToken.setMRVOracle(await oracle.getAddress());
    await oracle.attestProjectWithString(PROJECT_ID, IPFS_HASH, 1000, true);
    await oracle.attestProjectWithString(PROJECT_ID, IPFS_HASH, 1000, false);

    await expect(creditToken.connect(verifier).mintBatch(PROJECT_ID, IPFS_HASH, AMOUNT))
      .to.be.revertedWith("Project not approved by MRV oracle");
  });

  it("Should only let the admin point at an oracle", async function () {
    await expect(creditToken.connect(verifier).setMRVOracle(await oracle.getAddress()))
      .to.be.reverted;
  });

  it("Should only let the oracle admin attest", async function () {
    await expect(oracle.connect(verifier).attestProjectWithString(PROJECT_ID, IPFS_HASH, 1000, true))
      .to.be.reverted;
  });

  it("Should report attested tonnage", async function () {
    await oracle.attestProjectWithString(PROJECT_ID, IPFS_HASH, 12345, true);
    expect(await oracle.getVerifiedTonnage(PROJECT_ID)).to.equal(12345);
    expect(await oracle.isProjectApproved(PROJECT_ID)).to.be.true;
  });
});

describe("VerifierStake: configurable challenge window", function () {
  let creditToken, verifierStake;
  let owner, verifier, challenger, regulator;
  const INITIAL_AMOUNT = ethers.parseUnits("1000", 18);
  const MIN_STAKE = ETH("1");
  const CHALLENGE_BOND = ETH("0.1");
  const ONE_DAY = 24 * 60 * 60;

  beforeEach(async function () {
    [owner, verifier, challenger, regulator] = await ethers.getSigners();

    const CreditToken = await ethers.getContractFactory("CreditToken");
    creditToken = await CreditToken.deploy(owner.address);
    await creditToken.waitForDeployment();

    const VerifierStake = await ethers.getContractFactory("VerifierStake");
    verifierStake = await VerifierStake.deploy(
      await creditToken.getAddress(),
      owner.address,
      owner.address
    );
    await verifierStake.waitForDeployment();

    await creditToken.grantRole(await creditToken.DEFAULT_ADMIN_ROLE(), await verifierStake.getAddress());
    await creditToken.grantMinterRole(verifier.address);
    await verifierStake.grantVerifierRole(verifier.address);
    await verifierStake.grantRegulatorRole(regulator.address);
    await verifierStake.grantChallengerRole(challenger.address);

    await creditToken.connect(verifier).mintBatch(PROJECT_ID, IPFS_HASH, INITIAL_AMOUNT);
    await verifierStake.connect(verifier).depositStake({ value: MIN_STAKE });
  });

  it("Should default to the 90-day window", async function () {
    expect(await verifierStake.getChallengeWindow(1)).to.equal(90 * ONE_DAY);
    expect(await verifierStake.defaultChallengeWindow()).to.equal(90 * ONE_DAY);
  });

  it("Should apply a per-batch override", async function () {
    await verifierStake.setBatchChallengeWindow(1, 30 * ONE_DAY);

    expect(await verifierStake.getChallengeWindow(1)).to.equal(30 * ONE_DAY);
    expect(await verifierStake.batchChallengeWindow(1)).to.equal(30 * ONE_DAY);
    // Untouched batches keep the default.
    expect(await verifierStake.getChallengeWindow(2)).to.equal(90 * ONE_DAY);
  });

  it("Should let a shorter window close a batch early", async function () {
    await verifierStake.setBatchChallengeWindow(1, ONE_DAY);
    await time.increase(2 * ONE_DAY);

    await expect(
      verifierStake.connect(challenger).createChallenge(1, "QmEvidence", { value: CHALLENGE_BOND })
    ).to.be.revertedWith("Challenge window expired");
  });

  it("Should let a longer window keep a batch open", async function () {
    await verifierStake.setBatchChallengeWindow(1, 30 * ONE_DAY);
    await time.increase(2 * ONE_DAY);

    await verifierStake.connect(challenger).createChallenge(1, "QmEvidence", { value: CHALLENGE_BOND });
    expect(await verifierStake.challengeCount()).to.equal(1);
  });

  it("Should apply a new global default to batches without an override", async function () {
    await verifierStake.setDefaultChallengeWindow(7 * ONE_DAY);
    expect(await verifierStake.getChallengeWindow(1)).to.equal(7 * ONE_DAY);

    await time.increase(8 * ONE_DAY);
    await expect(
      verifierStake.connect(challenger).createChallenge(1, "QmEvidence", { value: CHALLENGE_BOND })
    ).to.be.revertedWith("Challenge window expired");
  });

  it("Should keep a per-batch override ahead of the global default", async function () {
    await verifierStake.setDefaultChallengeWindow(7 * ONE_DAY);
    await verifierStake.setBatchChallengeWindow(1, 60 * ONE_DAY);

    expect(await verifierStake.getChallengeWindow(1)).to.equal(60 * ONE_DAY);
  });

  it("Should fall back to the default once an override is cleared", async function () {
    await verifierStake.setBatchChallengeWindow(1, ONE_DAY);
    await verifierStake.clearBatchChallengeWindow(1);

    expect(await verifierStake.getChallengeWindow(1)).to.equal(90 * ONE_DAY);
  });

  it("Should reject windows outside the allowed bounds", async function () {
    await expect(verifierStake.setDefaultChallengeWindow(0)).to.be.revertedWith("Window out of bounds");
    await expect(verifierStake.setDefaultChallengeWindow(366 * ONE_DAY))
      .to.be.revertedWith("Window out of bounds");
    await expect(verifierStake.setBatchChallengeWindow(1, 0)).to.be.revertedWith("Window out of bounds");
    await expect(verifierStake.setBatchChallengeWindow(1, 366 * ONE_DAY))
      .to.be.revertedWith("Window out of bounds");
  });

  it("Should reject an override for a batch that does not exist", async function () {
    await expect(verifierStake.setBatchChallengeWindow(99, 30 * ONE_DAY))
      .to.be.revertedWith("Batch not found");
  });

  it("Should only let the admin configure windows", async function () {
    await expect(verifierStake.connect(challenger).setDefaultChallengeWindow(ONE_DAY)).to.be.reverted;
    await expect(verifierStake.connect(challenger).setBatchChallengeWindow(1, ONE_DAY)).to.be.reverted;
  });
});

describe("VerifierStake: per-batch compensation pool", function () {
  let creditToken, verifierStake;
  let owner, verifier, challenger, regulator, buyer1, buyer2, outsider;
  const INITIAL_AMOUNT = ethers.parseUnits("1000", 18);
  const BUYER1_AMOUNT = ethers.parseUnits("600", 18);
  const BUYER2_AMOUNT = ethers.parseUnits("400", 18);
  const MIN_STAKE = ETH("1");
  const CHALLENGE_BOND = ETH("0.1");
  const SLASHED = ETH("0.5");
  const CHALLENGER_REWARD = SLASHED / 2n;
  const COMPENSATION = SLASHED - CHALLENGER_REWARD;

  // 0.25 ETH against a 1000-token denominator
  const BUYER1_SHARE = (COMPENSATION * BUYER1_AMOUNT) / INITIAL_AMOUNT;
  const BUYER2_SHARE = (COMPENSATION * BUYER2_AMOUNT) / INITIAL_AMOUNT;

  beforeEach(async function () {
    [owner, verifier, challenger, regulator, buyer1, buyer2, outsider] = await ethers.getSigners();

    const CreditToken = await ethers.getContractFactory("CreditToken");
    creditToken = await CreditToken.deploy(owner.address);
    await creditToken.waitForDeployment();

    const VerifierStake = await ethers.getContractFactory("VerifierStake");
    verifierStake = await VerifierStake.deploy(
      await creditToken.getAddress(),
      owner.address,
      owner.address
    );
    await verifierStake.waitForDeployment();

    await creditToken.grantRole(await creditToken.DEFAULT_ADMIN_ROLE(), await verifierStake.getAddress());
    await creditToken.grantMinterRole(verifier.address);
    await verifierStake.grantVerifierRole(verifier.address);
    await verifierStake.grantRegulatorRole(regulator.address);
    await verifierStake.grantChallengerRole(challenger.address);

    await creditToken.connect(verifier).mintBatch(PROJECT_ID, IPFS_HASH, INITIAL_AMOUNT);

    // Spread the batch across two buyers, then run a successful challenge.
    await creditToken.connect(verifier).transfer(buyer1.address, BUYER1_AMOUNT);
    await creditToken.connect(verifier).transfer(buyer2.address, BUYER2_AMOUNT);

    await verifierStake.connect(verifier).depositStake({ value: MIN_STAKE });
    await verifierStake.connect(challenger).createChallenge(1, "QmEvidence", { value: CHALLENGE_BOND });
    await verifierStake.connect(regulator).resolveChallenge(1, true);
  });

  it("Should hold the buyers' half in a per-batch pool", async function () {
    expect(await verifierStake.batchCompensationPool(1)).to.equal(COMPENSATION);
    expect(await verifierStake.batchCompensationTotal(1)).to.equal(COMPENSATION);
    expect(await verifierStake.batchCompensationDenominator(1)).to.equal(INITIAL_AMOUNT);
  });

  it("Should emit CompensationPoolDeposited with the denominator", async function () {
    // Re-run the scenario inline so the event is captured on a fresh resolution.
    const [o, v, c, r] = await ethers.getSigners();
    const CreditToken = await ethers.getContractFactory("CreditToken");
    const token = await CreditToken.deploy(o.address);
    const VerifierStake = await ethers.getContractFactory("VerifierStake");
    const stake = await VerifierStake.deploy(await token.getAddress(), o.address, o.address);

    await token.grantRole(await token.DEFAULT_ADMIN_ROLE(), await stake.getAddress());
    await token.grantMinterRole(v.address);
    await stake.grantVerifierRole(v.address);
    await stake.grantRegulatorRole(r.address);
    await stake.grantChallengerRole(c.address);

    await token.connect(v).mintBatch(PROJECT_ID, IPFS_HASH, INITIAL_AMOUNT);
    await stake.connect(v).depositStake({ value: MIN_STAKE });
    await stake.connect(c).createChallenge(1, "QmEvidence", { value: CHALLENGE_BOND });

    await expect(stake.connect(r).resolveChallenge(1, true))
      .to.emit(stake, "CompensationPoolDeposited")
      .withArgs(1, COMPENSATION, INITIAL_AMOUNT);
  });

  it("Should pay each holder their pro-rata share", async function () {
    await expect(verifierStake.connect(buyer1).claimCompensation(1))
      .to.changeEtherBalance(buyer1, BUYER1_SHARE);

    await expect(verifierStake.connect(buyer2).claimCompensation(1))
      .to.changeEtherBalance(buyer2, BUYER2_SHARE);

    // The two shares must account for the whole pool.
    expect(BUYER1_SHARE + BUYER2_SHARE).to.equal(COMPENSATION);
    expect(await verifierStake.batchCompensationPool(1)).to.equal(0);
  });

  it("Should emit CompensationClaimed", async function () {
    await expect(verifierStake.connect(buyer1).claimCompensation(1))
      .to.emit(verifierStake, "CompensationClaimed")
      .withArgs(1, buyer1.address, BUYER1_SHARE);
  });

  it("Should report the share via the return value", async function () {
    expect(await verifierStake.connect(buyer1).claimCompensation.staticCall(1)).to.equal(BUYER1_SHARE);
  });

  it("Should stop a second claim from the same holder", async function () {
    await verifierStake.connect(buyer1).claimCompensation(1);
    await expect(verifierStake.connect(buyer1).claimCompensation(1))
      .to.be.revertedWith("Nothing to claim");
  });

  it("Should block the slashed verifier from claiming", async function () {
    await expect(verifierStake.connect(verifier).claimCompensation(1))
      .to.be.revertedWith("Verifier cannot claim compensation");
  });

  it("Should block an address holding none of the batch", async function () {
    await expect(verifierStake.connect(outsider).claimCompensation(1))
      .to.be.revertedWith("Nothing to claim");
  });

  it("Should revert when a batch has no compensation pool", async function () {
    await expect(verifierStake.connect(buyer1).claimCompensation(2))
      .to.be.revertedWith("No compensation pool");
  });

  it("Should freeze the batch so post-resolution buyers cannot claim", async function () {
    // Resolving in the challenger's favour flags the batch, which freezes it.
    // Acquiring credits after that must be impossible, so the set of claimants
    // stays exactly the holders who were exposed at resolution time.
    await expect(creditToken.connect(buyer1).transfer(outsider.address, BUYER1_AMOUNT))
      .to.be.revertedWith("Batch is flagged");

    expect(await creditToken.getUserBatchBalance(1, outsider.address)).to.equal(0);
    await expect(verifierStake.connect(outsider).claimCompensation(1))
      .to.be.revertedWith("Nothing to claim");

    // The two genuine holders can still take the whole pool, and no more.
    await verifierStake.connect(buyer2).claimCompensation(1);
    await verifierStake.connect(buyer1).claimCompensation(1);
    expect(await verifierStake.batchCompensationPool(1)).to.equal(0);
  });

  it("Should leave the other batches of a slashed verifier tradeable", async function () {
    // Flagging must be per-batch: a verifier's unrelated batches stay liquid.
    const other = await creditToken.connect(verifier).mintBatch.staticCall(
      "PROJ-OTHER",
      "QmOtherHash",
      INITIAL_AMOUNT
    );
    await creditToken.connect(verifier).mintBatch("PROJ-OTHER", "QmOtherHash", INITIAL_AMOUNT);

    expect(await creditToken.isBatchFlagged(1)).to.be.true;
    expect(await creditToken.isBatchFlagged(other)).to.be.false;

    await creditToken.connect(verifier).transfer(buyer1.address, ethers.parseUnits("10", 18));
    expect(await creditToken.getUserBatchBalance(other, buyer1.address))
      .to.equal(ethers.parseUnits("10", 18));
  });

  it("Should keep unclaimed compensation inside the contract", async function () {
    const info = await verifierStake.getVerifierInfo(verifier.address);
    expect(info[0]).to.equal(MIN_STAKE - SLASHED);
    expect(await verifierStake.getContractBalance()).to.equal(
      (MIN_STAKE - SLASHED) + COMPENSATION
    );
  });

  it("Should not credit a pool when the challenger loses", async function () {
    const CreditToken = await ethers.getContractFactory("CreditToken");
    const token = await CreditToken.deploy(owner.address);
    const VerifierStake = await ethers.getContractFactory("VerifierStake");
    const stake = await VerifierStake.deploy(await token.getAddress(), owner.address, owner.address);

    await token.grantRole(await token.DEFAULT_ADMIN_ROLE(), await stake.getAddress());
    await token.grantMinterRole(verifier.address);
    await stake.grantVerifierRole(verifier.address);
    await stake.grantRegulatorRole(regulator.address);
    await stake.grantChallengerRole(challenger.address);

    await token.connect(verifier).mintBatch(PROJECT_ID, IPFS_HASH, INITIAL_AMOUNT);
    await stake.connect(verifier).depositStake({ value: MIN_STAKE });
    await stake.connect(challenger).createChallenge(1, "QmEvidence", { value: CHALLENGE_BOND });
    await stake.connect(regulator).resolveChallenge(1, false);

    expect(await stake.batchCompensationPool(1)).to.equal(0);
    await expect(stake.connect(buyer1).claimCompensation(1)).to.be.revertedWith("No compensation pool");
  });
});

describe("RegulatorMultisig: threshold approval gate", function () {
  let creditToken, verifierStake, multisig;
  let owner, verifier, challenger, o1, o2, o3, o4, o5, outsider;
  const INITIAL_AMOUNT = ethers.parseUnits("1000", 18);
  const MIN_STAKE = ETH("1");
  const CHALLENGE_BOND = ETH("0.1");
  let owners;

  beforeEach(async function () {
    [owner, verifier, challenger, o1, o2, o3, o4, o5, outsider] = await ethers.getSigners();
    owners = [o1.address, o2.address, o3.address, o4.address, o5.address];

    const CreditToken = await ethers.getContractFactory("CreditToken");
    creditToken = await CreditToken.deploy(owner.address);
    await creditToken.waitForDeployment();

    const VerifierStake = await ethers.getContractFactory("VerifierStake");
    verifierStake = await VerifierStake.deploy(
      await creditToken.getAddress(),
      owner.address,
      owner.address
    );
    await verifierStake.waitForDeployment();

    const RegulatorMultisig = await ethers.getContractFactory("RegulatorMultisig");
    multisig = await RegulatorMultisig.deploy(owners, 3, await verifierStake.getAddress());
    await multisig.waitForDeployment();

    await creditToken.grantRole(await creditToken.DEFAULT_ADMIN_ROLE(), await verifierStake.getAddress());
    await creditToken.grantMinterRole(verifier.address);
    await verifierStake.grantVerifierRole(verifier.address);
    await verifierStake.grantChallengerRole(challenger.address);

    // The panel replaces the single regulator key entirely.
    await verifierStake.grantRegulatorRole(await multisig.getAddress());
    await verifierStake.revokeRegulatorRole(owner.address);

    await creditToken.connect(verifier).mintBatch(PROJECT_ID, IPFS_HASH, INITIAL_AMOUNT);
    await verifierStake.connect(verifier).depositStake({ value: MIN_STAKE });
    await verifierStake.connect(challenger).createChallenge(1, "QmEvidence", { value: CHALLENGE_BOND });
  });

  it("Should store the owners and the threshold", async function () {
    expect(await multisig.threshold()).to.equal(3);
    expect(await multisig.ownerCount()).to.equal(5);
    expect(await multisig.owners()).to.deep.equal(owners);
    for (const o of owners) {
      expect(await multisig.isOwner(o)).to.be.true;
    }
    expect(await multisig.isOwner(outsider.address)).to.be.false;
  });

  it("Should reject a duplicate owner", async function () {
    const RegulatorMultisig = await ethers.getContractFactory("RegulatorMultisig");
    await expect(
      RegulatorMultisig.deploy([o1.address, o1.address, o2.address], 2, await verifierStake.getAddress())
    ).to.be.revertedWith("Duplicate owner");
  });

  it("Should reject an invalid threshold", async function () {
    const RegulatorMultisig = await ethers.getContractFactory("RegulatorMultisig");
    await expect(
      RegulatorMultisig.deploy(owners, 0, await verifierStake.getAddress())
    ).to.be.revertedWith("Invalid threshold");
    await expect(
      RegulatorMultisig.deploy(owners, 6, await verifierStake.getAddress())
    ).to.be.revertedWith("Invalid threshold");
  });

  it("Should reject an empty owner set", async function () {
    const RegulatorMultisig = await ethers.getContractFactory("RegulatorMultisig");
    await expect(
      RegulatorMultisig.deploy([], 1, await verifierStake.getAddress())
    ).to.be.revertedWith("Owners required");
  });

  it("Should stop an EOA from resolving directly", async function () {
    await expect(verifierStake.connect(owner).resolveChallenge(1, true)).to.be.reverted;
  });

  it("Should refuse a proposal from a non-owner", async function () {
    await expect(multisig.connect(outsider).proposeResolution(1, true)).to.be.revertedWith("Not an owner");
  });

  it("Should refuse an approval from a non-owner", async function () {
    await multisig.connect(o1).proposeResolution(1, true);
    await expect(multisig.connect(outsider).approveResolution(1)).to.be.revertedWith("Not an owner");
  });

  it("Should require the threshold before executing", async function () {
    await multisig.connect(o1).proposeResolution(1, true);
    await multisig.connect(o1).approveResolution(1);
    await multisig.connect(o2).approveResolution(1);

    // Two of three is not enough.
    await expect(multisig.connect(o3).executeResolution(1)).to.be.revertedWith("Threshold not reached");
    expect((await verifierStake.getChallenge(1))[5]).to.be.false; // still unresolved
  });

  it("Should execute automatically on the third approval", async function () {
    await multisig.connect(o1).proposeResolution(1, true);
    await multisig.connect(o1).approveResolution(1);
    await multisig.connect(o2).approveResolution(1);
    await multisig.connect(o3).approveResolution(1);

    const challenge = await verifierStake.getChallenge(1);
    expect(challenge[5]).to.be.true;
    expect(challenge[6]).to.be.true;
  });

  it("Should slash the verifier when the panel approves fraud", async function () {
    await multisig.connect(o1).proposeResolution(1, true);
    await multisig.connect(o1).approveResolution(1);
    await multisig.connect(o2).approveResolution(1);
    await multisig.connect(o3).approveResolution(1);

    expect((await verifierStake.getVerifierInfo(verifier.address))[0]).to.equal(MIN_STAKE - ETH("0.5"));
    expect(await creditToken.isBatchFlagged(1)).to.be.true;
  });

  it("Should let the panel acquit a verifier", async function () {
    await multisig.connect(o1).proposeResolution(1, false);
    await multisig.connect(o1).approveResolution(1);
    await multisig.connect(o2).approveResolution(1);
    await multisig.connect(o3).approveResolution(1);

    const challenge = await verifierStake.getChallenge(1);
    expect(challenge[5]).to.be.true;
    expect(challenge[6]).to.be.false;
    expect(await creditToken.isBatchFlagged(1)).to.be.false;
  });

  it("Should reject a duplicate approval", async function () {
    await multisig.connect(o1).proposeResolution(1, true);
    await multisig.connect(o1).approveResolution(1);
    await expect(multisig.connect(o1).approveResolution(1)).to.be.revertedWith("Already approved");
  });

  it("Should reject a second proposal for the same challenge", async function () {
    await multisig.connect(o1).proposeResolution(1, true);
    await expect(multisig.connect(o2).proposeResolution(1, false))
      .to.be.revertedWith("Proposal already exists");
  });

  it("Should reject approving a challenge that was never proposed", async function () {
    await expect(multisig.connect(o1).approveResolution(7)).to.be.revertedWith("No such proposal");
  });

  it("Should reject executing a challenge that was never proposed", async function () {
    await expect(multisig.connect(o1).executeResolution(7)).to.be.revertedWith("No such proposal");
  });

  it("Should reject executing the same resolution twice", async function () {
    await multisig.connect(o1).proposeResolution(1, true);
    await multisig.connect(o1).approveResolution(1);
    await multisig.connect(o2).approveResolution(1);
    await multisig.connect(o3).approveResolution(1);

    await expect(multisig.connect(o4).executeResolution(1)).to.be.revertedWith("Already executed");
    await expect(multisig.connect(o4).approveResolution(1)).to.be.revertedWith("Already executed");
  });

  it("Should reject resolving a challenge that VerifierStake already resolved", async function () {
    await verifierStake.grantRegulatorRole(owner.address);
    await verifierStake.connect(owner).resolveChallenge(1, true);

    await multisig.connect(o1).proposeResolution(1, false);
    await multisig.connect(o1).approveResolution(1);
    await multisig.connect(o2).approveResolution(1);
    await expect(multisig.connect(o3).approveResolution(1))
      .to.be.revertedWith("Challenge already resolved");
  });

  it("Should let owners rotate members", async function () {
    await multisig.connect(o1).addOwner(outsider.address);
    expect(await multisig.isOwner(outsider.address)).to.be.true;
    expect(await multisig.ownerCount()).to.equal(6);

    await multisig.connect(o1).removeOwner(outsider.address);
    expect(await multisig.isOwner(outsider.address)).to.be.false;
    expect(await multisig.ownerCount()).to.equal(5);
  });

  it("Should refuse to shrink the panel below the threshold", async function () {
    // Each removal must come from an owner still on the panel.
    await multisig.connect(o2).removeOwner(o1.address);
    expect(await multisig.ownerCount()).to.equal(4);

    await multisig.connect(o3).removeOwner(o2.address);
    expect(await multisig.ownerCount()).to.equal(3);

    // Removing one more would leave 2 owners against a threshold of 3.
    await expect(multisig.connect(o4).removeOwner(o3.address))
      .to.be.revertedWith("Would drop below threshold");
    expect(await multisig.ownerCount()).to.equal(3);
  });

  it("Should refuse owner changes from a non-owner", async function () {
    await expect(multisig.connect(outsider).addOwner(outsider.address)).to.be.revertedWith("Not an owner");
    await expect(multisig.connect(outsider).removeOwner(o1.address)).to.be.revertedWith("Not an owner");
  });

  it("Should report the panel address so it can be audited", async function () {
    expect(await multisig.verifierStake()).to.equal(await verifierStake.getAddress());
  });
});
