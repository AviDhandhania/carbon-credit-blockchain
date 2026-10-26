/**
 * Prepares chain state for the research-paper experiment suite.
 *
 * Run AFTER `scripts/deploy.js` and `loadtest/setup-roles.js` on a fresh chain:
 *
 *   npx hardhat node                                            # terminal A
 *   npx hardhat run scripts/deploy.js --network localhost        # terminal B
 *   npx hardhat run loadtest/setup-roles.js --network localhost
 *   npx hardhat run loadtest/setup-experiment.js --network localhost
 *
 * What it adds on top of setup-roles.js:
 *
 *   1. Deploys BaselineVerifier (the "system without staking/challenge" used for
 *      the §9 comparison) and grants it MINTER_ROLE. Deployed last, so the six
 *      product addresses in frontend/src/utils/contracts.js do not move.
 *   2. Raises a1's stake so the successful-challenge scenario can actually slash
 *      something: slashing is 50% of the remaining stake, so scenario B needs a
 *      large deposit to survive a handful of resolutions.
 *   3. Mints the batch pool the staking scenarios challenge, one batch per
 *      (virtual user x iteration) so no two iterations contend for the same id.
 *
 * Writes loadtest/.experiment.env (ids, addresses, multisig owners).
 */
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

async function main() {
  const mod = await import(
    pathToFileURL(path.join(__dirname, '..', 'frontend', 'src', 'utils', 'contracts.js')).href
  );
  const A = mod.CONTRACT_ADDRESSES;

  const signers = await ethers.getSigners();
  const [deployer, a1, a2, a3, a4, a5] = signers;

  const token = await ethers.getContractAt('CreditToken', A.CreditToken, deployer);
  const stake = await ethers.getContractAt('VerifierStake', A.VerifierStake, deployer);
  const multisig = await ethers.getContractAt('RegulatorMultisig', A.RegulatorMultisig, deployer);

  const POOL = Number(process.env.POOL || 400);
  const log = (...x) => console.log(' ', ...x);

  // --- 1. baseline contract -------------------------------------------------
  const BaselineVerifier = await ethers.getContractFactory('BaselineVerifier');
  const baseline = await BaselineVerifier.deploy(A.CreditToken);
  await baseline.waitForDeployment();
  const baselineAddress = await baseline.getAddress();
  // The baseline approves projects by minting through the same CreditToken, so
  // the two systems issue identical credits and only differ by the staking and
  // challenge layer. Without this role the baseline simply cannot work.
  await (await token.grantMinterRole(baselineAddress)).wait();
  log(`BaselineVerifier deployed at ${baselineAddress} (MINTER_ROLE granted)`);

  // --- 2. stake depth for slashing -----------------------------------------
  const TARGET_STAKE = ethers.parseEther(process.env.TARGET_STAKE_ETH || '100');
  const current = (await stake.getVerifierInfo(a1.address))[0];
  if (current < TARGET_STAKE) {
    await (await stake.connect(a1).depositStake({ value: TARGET_STAKE - current })).wait();
  }
  const nowStake = (await stake.getVerifierInfo(a1.address))[0];
  log(`a1 stake = ${ethers.formatEther(nowStake)} ETH`);

  // --- 3. batch pool --------------------------------------------------------
  // One batch per (VU x iteration) in the staking scenarios, all minted by the
  // staked verifier a1 so a successful challenge has a stake to slash.
  const pool = [];
  const t0 = Date.now();
  for (let i = 0; i < POOL; i++) {
    const tx = await token
      .connect(a1)
      .mintBatch(`POOL-${i}`, `ipfs://pool-${i}`, ethers.parseUnits('1000', 18));
    const r = await tx.wait();
    const ev = r.logs
      .map((l) => {
        try {
          return token.interface.parseLog(l);
        } catch {
          return null;
        }
      })
      .find((e) => e && e.name === 'BatchMinted');
    if (!ev) throw new Error(`no BatchMinted for pool item ${i}`);
    pool.push(ev.args[0].toString());
  }
  log(`minted ${pool.length} pool batches in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  const owners = await multisig.owners();
  const threshold = await multisig.threshold();

  const hex = (v) => '0x' + BigInt(v).toString(16);
  const lines = [
    `BASELINE_ADDR=${baselineAddress}`,
    `POOL_SIZE=${pool.length}`,
    `POOL_IDS=${pool.join(',')}`,
    `A1_STAKE_HEX=${hex(nowStake)}`,
    `MULTISIG_OWNERS=${owners.join(',')}`,
    `MULTISIG_THRESHOLD=${threshold}`,
    // Three distinct owners are needed to reach a 3-of-5 threshold.
    `APPROVER_1=${owners[1]}`,
    `APPROVER_2=${owners[2]}`,
    `APPROVER_3=${owners[3]}`,
    `PROPOSER=${owners[0]}`,
  ];
  fs.writeFileSync(path.join(__dirname, '.experiment.env'), lines.join('\n') + '\n');
  console.log(`\nwrote loadtest/.experiment.env (pool=${pool.length}, ${threshold}-of-${owners.length})`);
  console.log(`BaselineVerifier: ${baselineAddress}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
