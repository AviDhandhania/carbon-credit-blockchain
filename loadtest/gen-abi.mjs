/**
 * Generates `generated-abi.js` for the k6 scripts.
 *
 * k6 runs JavaScript in a sandbox without ethers, so selectors and the simple
 * type maps are precomputed here from the SAME human-readable ABIs the frontend
 * uses (frontend/src/utils/contracts.js). Never hand-write a selector: rerun
 * this script instead.
 *
 * The load-test-only BaselineVerifier is not in the frontend's ABI map (it is
 * deliberately not a product contract), so its ABI is read from the compiled
 * artifact instead. Run `npx hardhat compile` first.
 *
 *   node loadtest/gen-abi.mjs
 */
import { ethers } from 'ethers';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONTRACT_ADDRESSES, CONTRACT_ABIS } from '../frontend/src/utils/contracts.js';

const HERE = dirname(fileURLToPath(import.meta.url));

const baselineArtifactPath = join(
  HERE,
  '..',
  'artifacts',
  'contracts',
  'loadtest',
  'BaselineVerifier.sol',
  'BaselineVerifier.json'
);
let BASELINE_ABI;
try {
  BASELINE_ABI = JSON.parse(readFileSync(baselineArtifactPath, 'utf8')).abi;
} catch {
  throw new Error(
    `BaselineVerifier artifact not found at ${baselineArtifactPath}. Run "npx hardhat compile" first.`
  );
}

// name -> [contract, signature, argTypes]
const CALLS = {
  // --- reads: credit / batch state -----------------------------------------
  totalSupply: ['CreditToken', 'totalSupply()', []],
  balanceOf: ['CreditToken', 'balanceOf(address)', ['address']],
  allowance: ['CreditToken', 'allowance(address,address)', ['address', 'address']],
  getBatchInfo: ['CreditToken', 'getBatchInfo(uint256)', ['uint256']],
  getBatchSupply: ['CreditToken', 'getBatchSupply(uint256)', ['uint256']],
  getBatchVerifier: ['CreditToken', 'getBatchVerifier(uint256)', ['uint256']],
  getBatchTimestamp: ['CreditToken', 'getBatchTimestamp(uint256)', ['uint256']],
  getBatchProjectId: ['CreditToken', 'getBatchProjectId(uint256)', ['uint256']],
  getBatchAmount: ['CreditToken', 'getBatchAmount(uint256)', ['uint256']],
  isBatchFlagged: ['CreditToken', 'isBatchFlagged(uint256)', ['uint256']],
  getUserBatchBalance: ['CreditToken', 'getUserBatchBalance(uint256,address)', ['uint256', 'address']],

  // --- reads: marketplace ---------------------------------------------------
  getListing: ['Marketplace', 'getListing(uint256)', ['uint256']],
  getActiveListings: ['Marketplace', 'getActiveListings()', []],
  getUserListings: ['Marketplace', 'getUserListings(address)', ['address']],
  listingCount: ['Marketplace', 'listingCount()', []],

  // --- reads: verifier stake / challenges -----------------------------------
  getVerifierInfo: ['VerifierStake', 'getVerifierInfo(address)', ['address']],
  getChallengeWindow: ['VerifierStake', 'getChallengeWindow(uint256)', ['uint256']],
  getChallenge: ['VerifierStake', 'getChallenge(uint256)', ['uint256']],
  getBatchChallenges: ['VerifierStake', 'getBatchChallenges(uint256)', ['uint256']],
  challengeCount: ['VerifierStake', 'challengeCount()', []],
  batchCompensationPool: ['VerifierStake', 'batchCompensationPool(uint256)', ['uint256']],

  // --- reads: multisig ------------------------------------------------------
  threshold: ['RegulatorMultisig', 'threshold()', []],
  ownerCount: ['RegulatorMultisig', 'ownerCount()', []],
  owners: ['RegulatorMultisig', 'owners()', []],
  proposal: ['RegulatorMultisig', 'proposals(uint256)', ['uint256']],

  // --- reads: retirement ----------------------------------------------------
  getUserCertificates: ['RetireAndCertify', 'getUserCertificates(address)', ['address']],
  certificateBalance: ['RetireAndCertify', 'balanceOf(address)', ['address']],
  getBatchTotalRetired: ['RetireAndCertify', 'getBatchTotalRetired(uint256)', ['uint256']],

  // --- writes ---------------------------------------------------------------
  mintBatch: ['CreditToken', 'mintBatch(string,string,uint256)', ['string', 'string', 'uint256']],
  splitBatch: ['CreditToken', 'splitBatch(uint256,uint256,string)', ['uint256', 'uint256', 'string']],
  approve: ['CreditToken', 'approve(address,uint256)', ['address', 'uint256']],
  createListing: ['Marketplace', 'createListing(uint256,uint256,uint256)', ['uint256', 'uint256', 'uint256']],
  cancelListing: ['Marketplace', 'cancelListing(uint256)', ['uint256']],
  buyTokens: ['Marketplace', 'buyTokens(uint256,uint256)', ['uint256', 'uint256']],
  retireAndCertify: ['RetireAndCertify', 'retireAndCertify(uint256,uint256,string)', ['uint256', 'uint256', 'string']],
  depositStake: ['VerifierStake', 'depositStake()', []],
  createChallenge: ['VerifierStake', 'createChallenge(uint256,string)', ['uint256', 'string']],
  resolveChallenge: ['VerifierStake', 'resolveChallenge(uint256,bool)', ['uint256', 'bool']],
  proposeResolution: ['RegulatorMultisig', 'proposeResolution(uint256,bool)', ['uint256', 'bool']],
  approveResolution: ['RegulatorMultisig', 'approveResolution(uint256)', ['uint256']],

  // --- baseline (load-test only) -------------------------------------------
  baselineSubmitProject: ['BaselineVerifier', 'submitProject(string,string,uint256)', ['string', 'string', 'uint256']],
  baselineApproveProject: ['BaselineVerifier', 'approveProject(uint256)', ['uint256']],
  baselineIsApproved: ['BaselineVerifier', 'isApproved(uint256)', ['uint256']],
  baselineGetProject: ['BaselineVerifier', 'getProject(uint256)', ['uint256']],
  baselineProjectCount: ['BaselineVerifier', 'projectCount()', []],
};

const ABIS = { ...CONTRACT_ABIS, BaselineVerifier: BASELINE_ABI };

const selectors = {};
const types = {};
for (const [name, [contract, sig, argTypes]] of Object.entries(CALLS)) {
  const iface = new ethers.Interface(ABIS[contract]);
  const fn = iface.getFunction(sig);
  if (!fn) throw new Error(`ABI has no ${sig} on ${contract}`);
  selectors[name] = fn.selector;
  types[name] = argTypes;
}

// Event topic0 hashes + how many of the leading params are indexed, so k6 can
// decode ids out of a receipt (eth_sendTransaction returns only the tx hash).
const EVENTS = {};
for (const [name, [contract, sig]] of Object.entries({
  ListingCreated: ['Marketplace', 'ListingCreated(uint256,uint256,address,uint256,uint256)'],
  BatchMinted: ['CreditToken', 'BatchMinted(uint256,string,address,uint256,uint256)'],
  ChallengeCreated: ['VerifierStake', 'ChallengeCreated(uint256,uint256,address,string)'],
  ProjectSubmitted: ['BaselineVerifier', 'ProjectSubmitted(uint256,address,string)'],
  ProjectApproved: ['BaselineVerifier', 'ProjectApproved(uint256,uint256,address)'],
})) {
  const iface = new ethers.Interface(ABIS[contract]);
  const ev = iface.getEvent(name);
  if (!ev) throw new Error(`ABI has no event ${name}`);
  EVENTS[name] = { topic0: ev.topicHash, indexed: ev.inputs.filter((i) => i.indexed).length };
}

// Wei amounts, computed by ethers. Hand-written wei hex constants are a bug
// factory (a 17- vs 18-digit slip turns 400 CC into 25 CC), so every amount the
// load scripts use is generated here instead.
const AMOUNTS = {};
const units = {
  thousand: '1000',
  four_hundred: '400',
  three_hundred: '300',
  two_hundred: '200',
  hundred: '100',
  fifty: '50',
  ten: '10',
  two: '2',
  one: '1',
  half: '0.5',
  quarter: '0.25',
};
for (const [k, v] of Object.entries(units)) AMOUNTS[k] = ethers.parseUnits(v, 18).toString(16);
for (const [k, v] of Object.entries({
  eth0001: '0.0001',
  eth001: '0.001',
  eth01: '0.1',
  eth05: '0.05',
  eth1: '1',
  eth5: '5',
})) {
  AMOUNTS[k] = ethers.parseEther(v).toString(16);
}
for (const k of Object.keys(AMOUNTS)) AMOUNTS[k] = '0x' + AMOUNTS[k];

// Gas limits are emitted as hex so scenarios stop hand-writing them.
const GAS = {
  // 2,000,000: retireAndCertify gas grows with the holder's batch count and a
  // fixed 500k limit caused 16.8% failures in the first soak (see F-4).
  standard: '0x1e8480',
  // 5,000,000: resolution writes several storage slots and flags a batch.
  heavy: '0x4c4b40',
  // 300,000: plain ERC-20 approve.
  approve: '0x493e0',
};

const out = `// GENERATED by loadtest/gen-abi.mjs — do not edit by hand.
// Source of truth: frontend/src/utils/contracts.js (addresses + ABIs), plus the
// compiled BaselineVerifier artifact for the load-test-only baseline contract.
export const ADDRESSES = ${JSON.stringify(CONTRACT_ADDRESSES, null, 2)};
export const SELECTORS = ${JSON.stringify(selectors, null, 2)};
export const TYPES = ${JSON.stringify(types, null, 2)};
export const EVENTS = ${JSON.stringify(EVENTS, null, 2)};
export const AMOUNTS = ${JSON.stringify(AMOUNTS, null, 2)};
export const GAS = ${JSON.stringify(GAS, null, 2)};
`;

writeFileSync(join(HERE, 'generated-abi.js'), out);
console.log(
  `Wrote generated-abi.js (${Object.keys(selectors).length} selectors, ${Object.keys(EVENTS).length} events, ${Object.keys(AMOUNTS).length} amounts)`
);
