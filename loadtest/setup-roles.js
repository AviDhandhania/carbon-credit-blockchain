/**
 * Prepares chain state for the k6 load scenarios.
 *
 * Why this exists (finding in its own right): scripts/deploy.js grants
 * MINTER/BUYER/RETIRE/VERIFIER/CHALLENGER roles to the DEPLOYER ONLY, so a
 * multi-actor load test — or a real multi-user deployment — needs an explicit
 * role-provisioning step. This script is that step, plus the seed state the
 * scenarios need (batches, allowance, listings).
 *
 * Usage:
 *   npx hardhat node                                         # terminal A
 *   npx hardhat run scripts/deploy.js --network localhost     # terminal B
 *   npx hardhat run loadtest/setup-roles.js --network localhost
 *
 * Writes loadtest/.state.env for the k6 runner. Idempotent per fresh chain.
 */
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

async function main() {
  const mod = await import(
    pathToFileURL(path.join(__dirname, '..', 'frontend', 'src', 'utils', 'contracts.js')).href
  );
  const { CONTRACT_ADDRESSES: A } = mod;

  const signers = await ethers.getSigners();
  const [deployer, a1, a2, a3, a4, a5] = signers;

  // Addresses come from the frontend (single source of truth); ABIs come from
  // the compiled artifacts, because the frontend's ABIs are deliberately
  // partial user-facing subsets that omit every admin/role function.
  const token = await ethers.getContractAt('CreditToken', A.CreditToken, deployer);
  const market = await ethers.getContractAt('Marketplace', A.Marketplace, deployer);
  const retire = await ethers.getContractAt('RetireAndCertify', A.RetireAndCertify, deployer);
  const stake = await ethers.getContractAt('VerifierStake', A.VerifierStake, deployer);

  const log = (...x) => console.log(' ', ...x);

  // --- roles -------------------------------------------------------------
  for (const s of [a1, a2, a3, a4, a5]) {
    await (await token.grantMinterRole(s.address)).wait();
    await (await market.grantBuyerRole(s.address)).wait();
    await (await retire.grantRetireRole(s.address)).wait();
    await (await stake.grantChallengerRole(s.address)).wait();
  }
  for (const s of [a1, a2]) await (await stake.grantVerifierRole(s.address)).wait();
  log('granted MINTER/BUYER/RETIRE/CHALLENGER to a1..a5, VERIFIER to a1..a2');

  // --- verifier stakes ---------------------------------------------------
  await (await stake.connect(a1).depositStake({ value: ethers.parseEther('1') })).wait();
  await (await stake.connect(a2).depositStake({ value: ethers.parseEther('1') })).wait();
  log('a1, a2 staked 1 ETH each');

  // --- batches -----------------------------------------------------------
  const ONE = ethers.parseUnits('1', 18);
  // Listing A is what the soak drains, so it gets a deep book on purpose:
  // a shallow listing turns the soak into a "listing ran dry" error stream
  // instead of a latency/state measurement.
  const batchA = await token.connect(a1).mintBatch.staticCall('PROJ-A', 'QmLoadA', ethers.parseUnits('200000', 18));
  await (await token.connect(a1).mintBatch('PROJ-A', 'QmLoadA', ethers.parseUnits('200000', 18))).wait();
  const batchB = await token.connect(a2).mintBatch.staticCall('PROJ-B', 'QmLoadB', ethers.parseUnits('500', 18));
  await (await token.connect(a2).mintBatch('PROJ-B', 'QmLoadB', ethers.parseUnits('500', 18))).wait();
  log(`minted batch ${batchA} (1000 CC, a1) and batch ${batchB} (500 CC, a2)`);

  // --- allowance: buyTokens does transferFrom(seller, buyer) -------------
  await (await token.connect(a1).approve(A.Marketplace, ethers.parseUnits('200000', 18))).wait();
  await (await token.connect(a2).approve(A.Marketplace, ethers.parseUnits('500', 18))).wait();
  log('sellers approved the Marketplace to pull their batches');

  // --- listings ----------------------------------------------------------
  const PRICE = ethers.parseUnits('0.001', 18); // per whole credit
  const listingA = await market.connect(a1).createListing.staticCall(batchA, ethers.parseUnits('200000', 18), PRICE);
  await (await market.connect(a1).createListing(batchA, ethers.parseUnits('200000', 18), PRICE)).wait();
  const listingB = await market.connect(a2).createListing.staticCall(batchB, ethers.parseUnits('400', 18), PRICE);
  await (await market.connect(a2).createListing(batchB, ethers.parseUnits('400', 18), PRICE)).wait();
  log(`listings: A=${listingA} (200000 CC @0.001, deep book), B=${listingB} (400 CC @0.001, race target)`);

  // Amounts are emitted as 0x hex: k6's runtime cannot hold 1e20-scale
  // decimals without losing precision, so they must never arrive as decimal.
  const hex = (v) => '0x' + BigInt(v).toString(16);
  const lines = [
    `BATCH_A=${batchA}`,
    `BATCH_B=${batchB}`,
    `LISTING_A=${listingA}`,
    `LISTING_B=${listingB}`,
    `SELLER_A=${a1.address}`,
    `SELLER_B=${a2.address}`,
    `ACC1=${a1.address}`,
    `ACC2=${a2.address}`,
    `ACC3=${a3.address}`,
    `ACC4=${a4.address}`,
    `ACC5=${a5.address}`,
    `DEPLOYER=${deployer.address}`,
    `PRICE_HEX=${hex(PRICE)}`,
    `AMT_1_HEX=${hex(ONE)}`,
    `AMT_HALF_HEX=${hex(ethers.parseUnits('0.5', 18))}`,
    `AMT_300_HEX=${hex(ethers.parseUnits('300', 18))}`,
    `AMT_100_HEX=${hex(ethers.parseUnits('100', 18))}`,
  ];
  fs.writeFileSync(path.join(__dirname, '.state.env'), lines.join('\n') + '\n');
  console.log(`\nwrote loadtest/.state.env (${lines.length} values)`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
