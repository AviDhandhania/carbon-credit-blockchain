/**
 * End-to-end check of the deployment through the SAME addresses and ABIs the
 * frontend uses (src/utils/contracts.js).
 *
 * The unit tests exercise the contracts directly; this verifies the wiring a
 * browser would actually hit: that every human-readable ABI string parses, that
 * the addresses line up, and that the DA3 flows work against a live chain.
 *
 * Needs untouched state, so run it right after a fresh node + deploy:
 *   npx hardhat node
 *   npx hardhat run scripts/deploy.js --network localhost
 *   cd frontend && node scripts/verify-integration.mjs
 */
import assert from 'node:assert/strict';
import { ethers } from 'ethers';
import { CONTRACT_ADDRESSES, CONTRACT_ABIS } from '../src/utils/contracts.js';

const RPC = process.env.RPC_URL || 'http://127.0.0.1:8545';

// Standard Hardhat accounts. Owners 0..4 back the 3-of-5 regulator panel.
const KEYS = [
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
  '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a',
];

const ONE = ethers.parseUnits('1000', 18);
// Batch 1 loses 300 to the split, so its circulating supply is 700 by the time
// a challenge resolves against it.
const EXPECTED_DENOM = ethers.parseUnits('700', 18);

let passed = 0;
let failed = 0;

async function check(name, fn) {
  try {
    await fn();
    console.log(`  ok  ${name}`);
    passed += 1;
  } catch (err) {
    console.log(`  FAIL ${name}\n       ${err.message.split('\n')[0]}`);
    failed += 1;
  }
}

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC);
  const wallets = KEYS.map((k) => new ethers.Wallet(k, provider));

  // ethers v6 caches eth_getTransactionCount for ~250ms, so a bare send loop
  // reuses nonces. Track them locally instead of trusting a fresh read.
  const nonces = new Map();
  async function nextNonce(address) {
    if (!nonces.has(address)) {
      nonces.set(address, await provider.getTransactionCount(address, 'pending'));
    }
    const n = nonces.get(address);
    nonces.set(address, n + 1);
    return n;
  }
  // build(overrides) must return the transaction promise.
  async function exec(wallet, build) {
    const tx = await build({ nonce: await nextNonce(wallet.address) });
    await tx.wait();
  }

  const tokenFor = (w) =>
    new ethers.Contract(CONTRACT_ADDRESSES.CreditToken, CONTRACT_ABIS.CreditToken, w);
  const stakeFor = (w) =>
    new ethers.Contract(CONTRACT_ADDRESSES.VerifierStake, CONTRACT_ABIS.VerifierStake, w);
  const multisigFor = (w) =>
    new ethers.Contract(
      CONTRACT_ADDRESSES.RegulatorMultisig,
      CONTRACT_ABIS.RegulatorMultisig,
      w
    );
  const oracleFor = (w) =>
    new ethers.Contract(CONTRACT_ADDRESSES.MockMRVOracle, CONTRACT_ABIS.MockMRVOracle, w);

  const token = tokenFor(wallets[0]);
  const stake = stakeFor(wallets[0]);
  const multisig = multisigFor(wallets[0]);
  const oracle = oracleFor(wallets[0]);

  // This script drives a real end-to-end scenario, so it needs untouched state.
  const supply = await token.totalSupply();
  if (supply !== 0n) {
    throw new Error(
      `Chain already has ${ethers.formatUnits(supply, 18)} credits minted. ` +
        'Restart the node and redeploy before running this check:\n' +
        '  npx hardhat node\n' +
        '  npx hardhat run scripts/deploy.js --network localhost'
    );
  }

  console.log('\n== ABIs parse and deployed addresses have code ==');
  for (const [name, addr] of Object.entries(CONTRACT_ADDRESSES)) {
    await check(`${name} at ${addr}`, async () => {
      const code = await provider.getCode(addr);
      assert.notEqual(code, '0x', `${name} has no bytecode at ${addr}`);
    });
  }

  console.log('\n== CreditToken ==');
  await check('name() and symbol() read through the frontend ABI', async () => {
    assert.equal(await token.name(), 'Carbon Credit');
    assert.equal(await token.symbol(), 'CC');
  });
  await check('MRV oracle is unwired by default', async () => {
    assert.equal(await token.mrvOracle(), ethers.ZeroAddress);
  });

  console.log('\n== Batch fractionalization ==');
  const batchId = 1;
  await check('mintBatch through the frontend ABI', async () => {
    await exec(wallets[0], (o) => token.mintBatch('PROJ-E2E', 'QmE2EHash', ONE, o));
    assert.equal(await token.getBatchSupply(batchId), ONE);
  });
  await check('splitBatch preserves total supply', async () => {
    const before = await token.totalSupply();
    await exec(wallets[0], (o) =>
      token.splitBatch(batchId, ethers.parseUnits('300', 18), 'PROJ-E2E-A', o)
    );

    assert.equal(await token.getBatchSupply(batchId), EXPECTED_DENOM);
    assert.equal(await token.getBatchSupply(2), ethers.parseUnits('300', 18));
    assert.equal(await token.getBatchParent(2), 1n);
    assert.equal(await token.totalSupply(), before, 'split must not mint');
  });

  console.log('\n== MRV oracle attestation ==');
  await check('wiring the oracle makes unattested minting revert', async () => {
    await exec(wallets[0], (o) => token.setMRVOracle(CONTRACT_ADDRESSES.MockMRVOracle, o));
    await assert.rejects(
      token.mintBatch.staticCall('PROJ-UNATTESTED', 'QmNothing', ONE),
      /Project not approved by MRV oracle/
    );
  });
  await check('an attested project mints successfully', async () => {
    await exec(wallets[0], (o) =>
      oracle.attestProjectWithString('PROJ-OK', 'QmOkHash', 500, true, o)
    );
    await exec(wallets[0], (o) => token.mintBatch('PROJ-OK', 'QmOkHash', ONE, o));
    assert.equal(await oracle.isProjectApproved('PROJ-OK'), true);
    assert.equal(await oracle.getVerifiedTonnage('PROJ-OK'), 500n);
  });
  await check('a hash mismatch is rejected', async () => {
    await assert.rejects(
      token.mintBatch.staticCall('PROJ-OK', 'QmWrongHash', ONE),
      /IPFS hash does not match MRV oracle/
    );
  });
  await check('unwiring the oracle restores permissionless minting', async () => {
    await exec(wallets[0], (o) => token.setMRVOracle(ethers.ZeroAddress, o));
    await exec(wallets[0], (o) => token.mintBatch('PROJ-ANY', 'QmAnyHash', ONE, o));
  });

  console.log('\n== Configurable challenge window ==');
  await check('default window is 90 days', async () => {
    assert.equal(await stake.getChallengeWindow(batchId), 90n * 86400n);
  });
  await check('a per-batch override is applied', async () => {
    await exec(wallets[0], (o) => stake.setBatchChallengeWindow(batchId, 30n * 86400n, o));
    assert.equal(await stake.getChallengeWindow(batchId), 30n * 86400n);
    assert.equal(await stake.defaultChallengeWindow(), 90n * 86400n);
  });

  console.log('\n== Regulator multisig ==');
  await check('threshold and owners read through the frontend ABI', async () => {
    assert.equal(await multisig.threshold(), 3n);
    assert.equal(await multisig.ownerCount(), 5n);
    const owners = await multisig.owners();
    assert.equal(owners.length, 5);
    assert.equal(await multisig.isOwner(wallets[0].address), true);
    assert.equal(await multisig.verifierStake(), CONTRACT_ADDRESSES.VerifierStake);
  });
  await check('the single-key regulator was revoked at deploy time', async () => {
    assert.equal(await stake.hasRole(await stake.REGULATOR_ROLE(), wallets[0].address), false);
    assert.equal(
      await stake.hasRole(await stake.REGULATOR_ROLE(), CONTRACT_ADDRESSES.RegulatorMultisig),
      true
    );
  });
  await check('proposals() getter parses (struct return)', async () => {
    const p = await multisig.proposals(1);
    assert.equal(p[0], 0n, 'unset proposals default to challengeId 0');
    assert.equal(p[2], 0n, 'no approvals yet');
    assert.equal(p[4], false, 'nothing proposed for challenge 1 yet');
  });

  console.log('\n== Full dispute flow through the panel ==');
  await check('verifier stakes and a challenge is raised', async () => {
    await exec(wallets[0], (o) => stake.depositStake({ value: ethers.parseEther('1'), ...o }));
    await exec(wallets[0], (o) =>
      stake.createChallenge(batchId, 'QmE2EEvidence', {
        value: ethers.parseEther('0.1'),
        ...o,
      })
    );
    assert.equal(await stake.challengeCount(), 1n);
  });
  await check('deployer alone cannot resolve (needs the panel)', async () => {
    await assert.rejects(stake.resolveChallenge.staticCall(1, true), /reverted/i);
  });
  await check('three owner approvals resolve the challenge', async () => {
    await exec(wallets[0], (o) => multisig.proposeResolution(1, true, o));
    for (const w of wallets) {
      await exec(w, (o) => multisigFor(w).approveResolution(1, o));
    }

    const challenge = await stake.getChallenge(1);
    assert.equal(challenge[5], true, 'challenge should be resolved');
    assert.equal(challenge[6], true, 'challenger should win');
    assert.equal(await token.isBatchFlagged(batchId), true);
  });
  await check('compensation pool is funded for the batch', async () => {
    assert.equal(await stake.batchCompensationPool(batchId), ethers.parseEther('0.25'));
    assert.equal(await stake.batchCompensationDenominator(batchId), EXPECTED_DENOM);
  });
  await check('the slashed verifier cannot claim compensation', async () => {
    await assert.rejects(
      stake.claimCompensation.staticCall(batchId),
      /Verifier cannot claim compensation/
    );
  });
  await check('the panel resolution is recorded as executed', async () => {
    const p = await multisig.proposals(1);
    assert.equal(p[2], 3n, 'three approvals recorded');
    assert.equal(p[3], true, 'executed');
    assert.equal(p[1], true, 'challenger wins');
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('\nFatal:', err.message);
  process.exit(1);
});
