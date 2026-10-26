/**
 * Gas measurements for the load-test report.
 *
 *   npx hardhat run loadtest/measure-gas.js --network localhost
 *
 * Includes the scaling experiment: CreditToken._retireBatch loops over the
 * holder's batch list, so retirement gas should grow with how many batches the
 * holder holds. The printed table is the evidence for that claim.
 */
const path = require('path');
const { pathToFileURL } = require('url');

async function main() {
  const A = (
    await import(pathToFileURL(path.join(__dirname, '..', 'frontend', 'src', 'utils', 'contracts.js')).href)
  ).CONTRACT_ADDRESSES;

  const s = await ethers.getSigners();
  const [a1] = s;
  const holder = s[15]; // not used by any other script
  const token = await ethers.getContractAt('CreditToken', A.CreditToken, a1);
  const market = await ethers.getContractAt('Marketplace', A.Marketplace, a1);
  const retire = await ethers.getContractAt('RetireAndCertify', A.RetireAndCertify, a1);
  const stake = await ethers.getContractAt('VerifierStake', A.VerifierStake, a1);

  const rows = [];
  const record = (label, used) => {
    rows.push([label, used]);
    console.log(`  ${label.padEnd(48)} ${used}`);
  };
  const gasOf = async (p) => (await (await p).wait()).gasUsed.toString();

  // Role provisioning again: without these four grants the holder cannot even
  // list, retire or stake — see the report's onboarding finding.
  await (await token.grantMinterRole(holder.address)).wait();
  await (await retire.grantRetireRole(holder.address)).wait();
  await (await market.grantBuyerRole(holder.address)).wait();
  await (await stake.grantVerifierRole(holder.address)).wait();

  // --- one-off action costs ------------------------------------------------
  let batchId = await token
    .connect(holder)
    .mintBatch.staticCall('PROJ-G', 'QmG', ethers.parseUnits('1000', 18));
  record('mintBatch (1000 CC)', await gasOf(token.connect(holder).mintBatch('PROJ-G', 'QmG', ethers.parseUnits('1000', 18))));
  record('approve (marketplace)', await gasOf(token.connect(holder).approve(A.Marketplace, ethers.parseUnits('1000', 18))));

  const listingId = await market
    .connect(holder)
    .createListing.staticCall(batchId, ethers.parseUnits('100', 18), ethers.parseEther('0.001'));
  record('createListing (100 CC)', await gasOf(market.connect(holder).createListing(batchId, ethers.parseUnits('100', 18), ethers.parseEther('0.001'))));
  record('buyTokens (1 CC)', await gasOf(market.connect(a1).buyTokens(listingId, ethers.parseUnits('1', 18), { value: ethers.parseEther('0.001') })));
  record('cancelListing', await gasOf(market.connect(holder).cancelListing(listingId)));
  record('depositStake (1 ETH)', await gasOf(stake.connect(holder).depositStake({ value: ethers.parseEther('1') })));

  // --- retire gas vs batches held -----------------------------------------
  await (await token.connect(holder).approve(A.RetireAndCertify, ethers.parseUnits('10000', 18))).wait();

  const retireGas = [];
  let held = 1; // the batch minted above
  for (const target of [1, 3, 6, 12]) {
    while (held < target) {
      await (await token.connect(holder).mintBatch(`PROJ-S-${target}-${held}`, 'QmS', ethers.parseUnits('100', 18))).wait();
      held += 1;
    }
    const used = await gasOf(
      retire.connect(holder).retireAndCertify(batchId, ethers.parseUnits('0.1', 18), 'ipfs://gas-probe')
    );
    retireGas.push([held, used]);
    record(`retireAndCertify (holder holds ${held} batches)`, used);
  }

  console.log('\n=== retire gas vs batches held ===');
  for (const [n, g] of retireGas) console.log(`  ${n} batch(es): gasUsed=${g}`);

  console.log('\n=== all measurements ===');
  for (const [l, g] of rows) console.log(`  ${l}: ${g}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
