const { expect } = require("chai");
const { ethers } = require("hardhat");
require("@nomicfoundation/hardhat-chai-matchers");

describe("CreditToken", function () {
  let creditToken;
  let owner, verifier, buyer1, buyer2, addr1;
  const PROJECT_ID = "PROJ-001";
  const IPFS_HASH = "QmTestHash123";
  const INITIAL_AMOUNT = ethers.parseUnits("1000", 18);

  beforeEach(async function () {
    [owner, verifier, buyer1, buyer2, addr1] = await ethers.getSigners();

    const CreditToken = await ethers.getContractFactory("CreditToken");
    creditToken = await CreditToken.deploy(owner.address);
    await creditToken.waitForDeployment();

    await creditToken.grantMinterRole(verifier.address);
    await creditToken.grantVerifierRole(verifier.address);
    await creditToken.grantMinterRole(owner.address);
  });

  describe("Deployment", function () {
    it("Should set correct name and symbol", async function () {
      expect(await creditToken.name()).to.equal("Carbon Credit");
      expect(await creditToken.symbol()).to.equal("CC");
    });

    it("Should grant roles to deployer", async function () {
      expect(await creditToken.hasRole(await creditToken.DEFAULT_ADMIN_ROLE(), owner.address)).to.be.true;
      expect(await creditToken.hasRole(await creditToken.MINTER_ROLE(), owner.address)).to.be.true;
    });
  });

  describe("Batch Minting", function () {
    it("Should allow minter to mint a batch", async function () {
      const tx = await creditToken.connect(verifier).mintBatch(PROJECT_ID, IPFS_HASH, INITIAL_AMOUNT);
      await tx.wait();

      expect(await creditToken.totalSupply()).to.equal(INITIAL_AMOUNT);
      expect(await creditToken.balanceOf(verifier.address)).to.equal(INITIAL_AMOUNT);

      const batchId = 1;
      const batch = await creditToken.getBatchInfo(batchId);
      expect(batch[0]).to.equal(PROJECT_ID);
      expect(batch[1]).to.equal(verifier.address);
      expect(batch[2]).to.equal(IPFS_HASH);
      expect(batch[3]).to.equal(INITIAL_AMOUNT);
      expect(batch[5]).to.be.false;
      expect(batch[6]).to.be.false;
    });

    it("Should revert if non-minter tries to mint", async function () {
      await expect(creditToken.connect(buyer1).mintBatch(PROJECT_ID, IPFS_HASH, INITIAL_AMOUNT))
        .to.be.reverted;
    });

    it("Should revert if amount is zero", async function () {
      await expect(creditToken.connect(verifier).mintBatch(PROJECT_ID, IPFS_HASH, 0))
        .to.be.revertedWith("Amount must be > 0");
    });
  });

  describe("Batch Retirement", function () {
    let batchId;

    beforeEach(async function () {
      const tx = await creditToken.connect(verifier).mintBatch(PROJECT_ID, IPFS_HASH, INITIAL_AMOUNT);
      await tx.wait();
      batchId = 1;
    });

    it("Should allow user to retire their batch tokens", async function () {
      const retireAmount = ethers.parseUnits("100", 18);
      await creditToken.connect(verifier).retireBatch(batchId, retireAmount);

      expect(await creditToken.balanceOf(verifier.address)).to.equal(INITIAL_AMOUNT - retireAmount);
      expect(await creditToken.getUserBatchBalance(batchId, verifier.address)).to.equal(INITIAL_AMOUNT - retireAmount);
      expect(await creditToken.totalSupply()).to.equal(INITIAL_AMOUNT - retireAmount);
    });

    it("Should allow contract to retire on behalf of user", async function () {
      const retireAmount = ethers.parseUnits("100", 18);
      await creditToken.connect(verifier).approve(owner.address, retireAmount);
      await creditToken.connect(owner).retireBatchFrom(verifier.address, batchId, retireAmount);

      expect(await creditToken.balanceOf(verifier.address)).to.equal(INITIAL_AMOUNT - retireAmount);
      expect(await creditToken.getUserBatchBalance(batchId, verifier.address)).to.equal(INITIAL_AMOUNT - retireAmount);
      expect(await creditToken.totalSupply()).to.equal(INITIAL_AMOUNT - retireAmount);
    });

    it("Should revert if insufficient batch balance", async function () {
      await expect(creditToken.connect(verifier).retireBatch(batchId, INITIAL_AMOUNT + 1n))
        .to.be.revertedWith("Insufficient batch balance");
    });

    it("Should revert if batch is flagged", async function () {
      await creditToken.flagBatch(batchId, true);
      await expect(creditToken.connect(verifier).retireBatch(batchId, ethers.parseUnits("100", 18)))
        .to.be.revertedWith("Batch is flagged");
    });
  });

  describe("Batch Flagging", function () {
    let batchId;

    beforeEach(async function () {
      const tx = await creditToken.connect(verifier).mintBatch(PROJECT_ID, IPFS_HASH, INITIAL_AMOUNT);
      await tx.wait();
      batchId = 1;
    });

    it("Should allow admin to flag batch", async function () {
      await creditToken.flagBatch(batchId, true);
      const batch = await creditToken.getBatchInfo(batchId);
      expect(batch[6]).to.be.true;
    });

    it("Should revert if non-admin tries to flag", async function () {
      await expect(creditToken.connect(buyer1).flagBatch(batchId, true))
        .to.be.reverted;
    });
  });
});

describe("Marketplace", function () {
  let creditToken, marketplace;
  let owner, seller, buyer1, buyer2, addr1;
  const PROJECT_ID = "PROJ-001";
  const IPFS_HASH = "QmTestHash123";
  const INITIAL_AMOUNT = ethers.parseUnits("1000", 18);
  const LISTING_AMOUNT = ethers.parseUnits("100", 18);
  const PRICE_PER_TOKEN = ethers.parseEther("0.00001");

  beforeEach(async function () {
    [owner, seller, buyer1, buyer2, addr1] = await ethers.getSigners();

    const CreditToken = await ethers.getContractFactory("CreditToken");
    creditToken = await CreditToken.deploy(owner.address);
    await creditToken.waitForDeployment();

    const Marketplace = await ethers.getContractFactory("Marketplace");
    marketplace = await Marketplace.deploy(await creditToken.getAddress(), owner.address);
    await marketplace.waitForDeployment();

    await creditToken.grantMinterRole(seller.address);
    await marketplace.grantBuyerRole(buyer1.address);
    await marketplace.grantBuyerRole(buyer2.address);
    await marketplace.grantBuyerRole(seller.address);

    const tx = await creditToken.connect(seller).mintBatch(PROJECT_ID, IPFS_HASH, INITIAL_AMOUNT);
    await tx.wait();
  });

  describe("Deployment", function () {
    it("Should set correct credit token address", async function () {
      expect(await marketplace.creditToken()).to.equal(await creditToken.getAddress());
    });

    it("Should grant roles to deployer", async function () {
      expect(await marketplace.hasRole(await marketplace.DEFAULT_ADMIN_ROLE(), owner.address)).to.be.true;
    });
  });

  describe("Listing Creation", function () {
    it("Should allow seller to create listing", async function () {
      const listingId = await marketplace.connect(seller).createListing.staticCall(1, LISTING_AMOUNT, PRICE_PER_TOKEN);
      await marketplace.connect(seller).createListing(1, LISTING_AMOUNT, PRICE_PER_TOKEN);

      const listing = await marketplace.getListing(listingId);
      expect(Number(listing[0])).to.equal(1);
      expect(listing[1]).to.equal(seller.address);
      expect(listing[2]).to.equal(LISTING_AMOUNT);
      expect(listing[3]).to.equal(PRICE_PER_TOKEN);
      expect(listing[4]).to.be.true;
    });

    it("Should revert if insufficient batch balance", async function () {
      await expect(marketplace.connect(seller).createListing(1, INITIAL_AMOUNT + 1n, PRICE_PER_TOKEN))
        .to.be.revertedWith("Insufficient batch balance");
    });

    it("Should revert if price is zero", async function () {
      await expect(marketplace.connect(seller).createListing(1, LISTING_AMOUNT, 0))
        .to.be.revertedWith("Price must be > 0");
    });
  });

  describe("Listing Cancellation", function () {
    let listingId;

    beforeEach(async function () {
      const tx = await marketplace.connect(seller).createListing(1, LISTING_AMOUNT, PRICE_PER_TOKEN);
      await tx.wait();
      listingId = 1;
    });

    it("Should allow seller to cancel listing", async function () {
      await marketplace.connect(seller).cancelListing(listingId);
      const listing = await marketplace.getListing(listingId);
      expect(listing[4]).to.be.false;
    });

    it("Should revert if non-seller tries to cancel", async function () {
      await expect(marketplace.connect(buyer1).cancelListing(listingId))
        .to.be.revertedWith("Only seller can cancel");
    });
  });

  describe("Price Update", function () {
    let listingId;

    beforeEach(async function () {
      const tx = await marketplace.connect(seller).createListing(1, LISTING_AMOUNT, PRICE_PER_TOKEN);
      await tx.wait();
      listingId = 1;
    });

    it("Should allow seller to update price", async function () {
      const newPrice = ethers.parseEther("0.00002");
      await marketplace.connect(seller).updateListingPrice(listingId, newPrice);
      const listing = await marketplace.getListing(listingId);
      expect(listing[3]).to.equal(newPrice);
    });
  });

  describe("Token Purchase", function () {
    let listingId;

    beforeEach(async function () {
      const tx = await marketplace.connect(seller).createListing(1, LISTING_AMOUNT, PRICE_PER_TOKEN);
      await tx.wait();
      listingId = 1;

      // Fund buyer with ETH for gas
      await owner.sendTransaction({ to: buyer1.address, value: ethers.parseEther("100") });
    });

    it("Should allow buyer to purchase tokens", async function () {
      const buyAmount = ethers.parseUnits("50", 18);
      const totalPrice = buyAmount * PRICE_PER_TOKEN;

      await marketplace.connect(buyer1).buyTokens(listingId, buyAmount, { value: totalPrice });

      expect(await creditToken.getUserBatchBalance(1, buyer1.address)).to.equal(buyAmount);
      expect(await creditToken.getUserBatchBalance(1, seller.address)).to.equal(LISTING_AMOUNT - buyAmount);
    });

    it("Should refund excess payment", async function () {
      const buyAmount = ethers.parseUnits("50", 18);
      const totalPrice = buyAmount * PRICE_PER_TOKEN;
      const excess = ethers.parseEther("0.1");

      const tx = await marketplace.connect(buyer1).buyTokens(listingId, buyAmount, { value: totalPrice + excess });
      await tx.wait();

      const listing = await marketplace.getListing(listingId);
      expect(listing[2]).to.equal(LISTING_AMOUNT - buyAmount);
    });

    it("Should revert if insufficient payment", async function () {
      const buyAmount = ethers.parseUnits("50", 18);
      const totalPrice = buyAmount * PRICE_PER_TOKEN;

      await expect(marketplace.connect(buyer1).buyTokens(listingId, buyAmount, { value: totalPrice - 1n }))
        .to.be.revertedWith("Insufficient payment");
    });

    it("Should deactivate listing when fully purchased", async function () {
      await marketplace.connect(buyer1).buyTokens(listingId, LISTING_AMOUNT, { value: LISTING_AMOUNT * PRICE_PER_TOKEN });
      const listing = await marketplace.getListing(listingId);
      expect(listing[4]).to.be.false;
      expect(listing[2]).to.equal(0);
    });
  });
});

describe("RetireAndCertify", function () {
  let creditToken, retireAndCertify;
  let owner, holder, addr1;
  const PROJECT_ID = "PROJ-001";
  const IPFS_HASH = "QmTestHash123";
  const INITIAL_AMOUNT = ethers.parseUnits("1000", 18);
  const RETIRE_AMOUNT = ethers.parseUnits("100", 18);
  const METADATA_URI = "ipfs://QmCertificateMetadata";

  beforeEach(async function () {
    [owner, holder, addr1] = await ethers.getSigners();

    const CreditToken = await ethers.getContractFactory("CreditToken");
    creditToken = await CreditToken.deploy(owner.address);
    await creditToken.waitForDeployment();

    const RetireAndCertify = await ethers.getContractFactory("RetireAndCertify");
    retireAndCertify = await RetireAndCertify.deploy(await creditToken.getAddress(), owner.address);
    await retireAndCertify.waitForDeployment();

    await creditToken.grantMinterRole(holder.address);
    await retireAndCertify.grantRetireRole(holder.address);

    const tx = await creditToken.connect(holder).mintBatch(PROJECT_ID, IPFS_HASH, INITIAL_AMOUNT);
    await tx.wait();
  });

  describe("Deployment", function () {
    it("Should set correct name and symbol", async function () {
      expect(await retireAndCertify.name()).to.equal("Retirement Certificate");
      expect(await retireAndCertify.symbol()).to.equal("RTC");
    });
  });

  describe("Retire and Certify", function () {
    it("Should allow retire role to retire tokens and mint certificate", async function () {
      // Approve RetireAndCertify to retire tokens on behalf of holder
      await creditToken.connect(holder).approve(await retireAndCertify.getAddress(), RETIRE_AMOUNT);

      const certId = await retireAndCertify.connect(holder).retireAndCertify.staticCall(1, RETIRE_AMOUNT, METADATA_URI);
      await retireAndCertify.connect(holder).retireAndCertify(1, RETIRE_AMOUNT, METADATA_URI);

      expect(await creditToken.balanceOf(holder.address)).to.equal(INITIAL_AMOUNT - RETIRE_AMOUNT);
      expect(await creditToken.getUserBatchBalance(1, holder.address)).to.equal(INITIAL_AMOUNT - RETIRE_AMOUNT);
      expect(await creditToken.totalSupply()).to.equal(INITIAL_AMOUNT - RETIRE_AMOUNT);

      expect(await retireAndCertify.balanceOf(holder.address)).to.equal(1);
      expect(await retireAndCertify.ownerOf(certId)).to.equal(holder.address);

      const cert = await retireAndCertify.getCertificate(certId);
      expect(cert[0]).to.equal(holder.address);
      expect(cert[1]).to.equal(1);
      expect(cert[2]).to.equal(RETIRE_AMOUNT);
      expect(cert[3]).to.equal(PROJECT_ID);
      expect(cert[5]).to.equal(METADATA_URI);
    });

    it("Should revert if insufficient batch balance", async function () {
      await creditToken.connect(holder).approve(await retireAndCertify.getAddress(), INITIAL_AMOUNT + 1n);
      await expect(retireAndCertify.connect(holder).retireAndCertify(1, INITIAL_AMOUNT + 1n, METADATA_URI))
        .to.be.revertedWith("Insufficient batch balance");
    });

    it("Should revert if batch is flagged", async function () {
      await creditToken.flagBatch(1, true);
      await creditToken.connect(holder).approve(await retireAndCertify.getAddress(), RETIRE_AMOUNT);
      await expect(retireAndCertify.connect(holder).retireAndCertify(1, RETIRE_AMOUNT, METADATA_URI))
        .to.be.revertedWith("Batch is flagged");
    });

    it("Should revert if metadata URI is empty", async function () {
      await creditToken.connect(holder).approve(await retireAndCertify.getAddress(), RETIRE_AMOUNT);
      await expect(retireAndCertify.connect(holder).retireAndCertify(1, RETIRE_AMOUNT, ""))
        .to.be.revertedWith("Metadata URI required");
    });
  });

  describe("Soulbound Certificate", function () {
    let certId;

    beforeEach(async function () {
      await creditToken.connect(holder).approve(await retireAndCertify.getAddress(), RETIRE_AMOUNT);
      const tx = await retireAndCertify.connect(holder).retireAndCertify(1, RETIRE_AMOUNT, METADATA_URI);
      await tx.wait();
      certId = 1;
    });

    it("Should not allow transfer", async function () {
      await expect(retireAndCertify.connect(holder).transferFrom(holder.address, addr1.address, certId))
        .to.be.revertedWith("Certificate is soulbound: cannot transfer");
    });

    it("Should not allow safeTransferFrom", async function () {
      await expect(retireAndCertify.connect(holder).safeTransferFrom(holder.address, addr1.address, certId))
        .to.be.revertedWith("Certificate is soulbound: cannot transfer");
    });

    it("Should not allow approve", async function () {
      await expect(retireAndCertify.connect(holder).approve(addr1.address, certId))
        .to.be.revertedWith("Certificate is soulbound: cannot approve");
    });

    it("Should not allow setApprovalForAll", async function () {
      await expect(retireAndCertify.connect(holder).setApprovalForAll(addr1.address, true))
        .to.be.revertedWith("Certificate is soulbound: cannot set approval");
    });
  });
});

describe("VerifierStake", function () {
  let creditToken, verifierStake;
  let owner, verifier, challenger, regulator, addr1;
  const PROJECT_ID = "PROJ-001";
  const IPFS_HASH = "QmTestHash123";
  const INITIAL_AMOUNT = ethers.parseUnits("1000", 18);
  const MIN_STAKE = ethers.parseEther("1");
  const CHALLENGE_BOND = ethers.parseEther("0.1");

  beforeEach(async function () {
    [owner, verifier, challenger, regulator, addr1] = await ethers.getSigners();

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

    // Grant VerifierStake the admin role on CreditToken to flag batches
    await creditToken.grantRole(await creditToken.DEFAULT_ADMIN_ROLE(), await verifierStake.getAddress());

    await creditToken.grantMinterRole(verifier.address);
    await verifierStake.grantVerifierRole(verifier.address);
    await verifierStake.grantRegulatorRole(regulator.address);
    await verifierStake.grantChallengerRole(challenger.address);

    const tx = await creditToken.connect(verifier).mintBatch(PROJECT_ID, IPFS_HASH, INITIAL_AMOUNT);
    await tx.wait();
  });

  describe("Stake Management", function () {
    it("Should allow verifier to deposit stake", async function () {
      await verifierStake.connect(verifier).depositStake({ value: MIN_STAKE });
      const info = await verifierStake.getVerifierInfo(verifier.address);
      expect(info[0]).to.equal(MIN_STAKE);
      expect(info[2]).to.be.true;
    });

    it("Should revert if deposit below minimum", async function () {
      await expect(verifierStake.connect(verifier).depositStake({ value: MIN_STAKE - 1n }))
        .to.be.revertedWith("Minimum stake is 1 ETH");
    });

    it("Should allow verifier to withdraw stake", async function () {
      await verifierStake.connect(verifier).depositStake({ value: MIN_STAKE });
      await verifierStake.connect(verifier).withdrawStake(MIN_STAKE);
      const info = await verifierStake.getVerifierInfo(verifier.address);
      expect(info[0]).to.equal(0);
    });

    it("Should revert if withdrawal leaves stake below minimum", async function () {
      await verifierStake.connect(verifier).depositStake({ value: MIN_STAKE * 2n });
      await expect(verifierStake.connect(verifier).withdrawStake(MIN_STAKE * 2n - 1n))
        .to.be.revertedWith("Must maintain minimum stake");
    });
  });

  describe("Challenge Creation", function () {
    beforeEach(async function () {
      await verifierStake.connect(verifier).depositStake({ value: MIN_STAKE });
    });

    it("Should allow challenger to create challenge with bond", async function () {
      const evidenceHash = "QmEvidenceHash";
      await verifierStake.connect(challenger).createChallenge(1, evidenceHash, { value: CHALLENGE_BOND });

      const challenge = await verifierStake.getChallenge(1);
      expect(challenge[0]).to.equal(1);
      expect(challenge[1]).to.equal(challenger.address);
      expect(challenge[2]).to.equal(evidenceHash);
      expect(challenge[3]).to.equal(CHALLENGE_BOND);
      expect(challenge[5]).to.be.false; // isResolved is at index 5
    });

    it("Should revert if bond too low", async function () {
      await expect(verifierStake.connect(challenger).createChallenge(1, "evidence", { value: CHALLENGE_BOND - 1n }))
        .to.be.revertedWith("Minimum challenge bond is 0.1 ETH");
    });
  });

  describe("Challenge Resolution", function () {
    beforeEach(async function () {
      await verifierStake.connect(verifier).depositStake({ value: MIN_STAKE });
      await verifierStake.connect(challenger).createChallenge(1, "QmEvidenceHash", { value: CHALLENGE_BOND });
    });

    it("Should allow regulator to resolve challenge in favor of challenger", async function () {
      await verifierStake.connect(regulator).resolveChallenge(1, true);

      const challenge = await verifierStake.getChallenge(1);
      expect(challenge[5]).to.be.true; // isResolved
      expect(challenge[6]).to.be.true; // challengerWon

      const verifierInfo = await verifierStake.getVerifierInfo(verifier.address);
      expect(verifierInfo[0]).to.be.lt(MIN_STAKE);
    });

    it("Should allow regulator to resolve challenge in favor of verifier", async function () {
      await verifierStake.connect(regulator).resolveChallenge(1, false);

      const challenge = await verifierStake.getChallenge(1);
      expect(challenge[5]).to.be.true;
      expect(challenge[6]).to.be.false;
    });
  });
});