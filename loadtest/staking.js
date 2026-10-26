/**
 * STAKING — the four staking/challenge scenarios of specification §8.
 *
 *   SCENARIO=A  Normal verification: a staked verifier stakes and attests
 *               (mintBatch = the on-chain verification), then the batch sits in
 *               its challenge window. Measures the cost of a staked verification.
 *
 *   SCENARIO=B  Successful challenge: challenger posts a 0.1 ETH bond, the
 *               3-of-5 regulator panel proposes and approves, the resolution
 *               slashes half the verifier's stake and flags the batch.
 *
 *   SCENARIO=C  Unsuccessful challenge: identical flow, resolved against the
 *               challenger. The bond is forfeited; no stake is slashed.
 *
 *   SCENARIO=D  Concurrent challenges: every VU challenges the SAME batch, so
 *               the run measures contention (successes, reverts, no-receipt)
 *               on one verification rather than on independent ones.
 *
 * Each iteration consumes a distinct batch from the pool minted by
 * `setup-experiment.js` (index = global iteration number), except D, which
 * deliberately piles onto pool batch 0.
 *
 *   SCENARIO=B TARGET_VUS=5 ITERATIONS=8 bash -c 'set -a; . loadtest/.state.env; \
 *     . loadtest/.experiment.env; set +a; "/c/Program Files/k6/k6.exe" run loadtest/staking.js'
 */
import { sleep } from 'k6';
import exec from 'k6/execution';
import { Counter, Trend } from 'k6/metrics';
import {
  call,
  sendTx,
  encode,
  confirm,
  logId,
  shortReason,
  ADDRESSES,
  AMOUNTS,
  GAS,
  EVENTS,
  enableGroups,
  opGroups,
} from './lib.js';

const SCEN = (__ENV.SCENARIO || 'A').toUpperCase();
const TARGET = Number(__ENV.TARGET_VUS || 5);
const ITERATIONS = Number(__ENV.ITERATIONS || 5);

const ACCOUNTS = [__ENV.ACC1, __ENV.ACC2, __ENV.ACC3, __ENV.ACC4, __ENV.ACC5].filter(Boolean);
const POOL = (__ENV.POOL_IDS || '1').split(',').filter(Boolean);
const CHALLENGERS = [__ENV.ACC3, __ENV.ACC4, __ENV.ACC5].filter(Boolean);
const PROPOSER = __ENV.PROPOSER || __ENV.DEPLOYER;
const APPROVERS = [__ENV.APPROVER_1, __ENV.APPROVER_2, __ENV.APPROVER_3].filter(Boolean);
// The 3-of-5 threshold is read from the chain at setup; a 4th approver would be
// needed if the panel's threshold were ever raised above 3.
const THRESHOLD = Number(__ENV.MULTISIG_THRESHOLD || 3);

export const challengesCreated = new Counter('challenges_created');
export const challengesResolved = new Counter('challenges_resolved');
export const lifecycleMs = new Trend('challenge_lifecycle_ms', true);
export const stakeMs = new Trend('stake_lifecycle_ms', true);
export const scenarioErrors = new Counter('staking_errors_by_reason');

const OPS = ['stake', 'mint', 'challenge', 'propose', 'msig', 'read'];

export const options = {
  setupTimeout: '600s',
  scenarios: {
    staking: {
      executor: 'per-vu-iterations',
      vus: TARGET,
      iterations: ITERATIONS,
      maxDuration: __ENV.MAX_DURATION || '30m',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    rpc_ok: ['rate>0.99'],
    ...enableGroups([
      'http_req_duration',
      'http_reqs',
      'challenges_created',
      'challenges_resolved',
      'challenge_lifecycle_ms',
      'stake_lifecycle_ms',
      ...opGroups(
        [
          'rpc_ok',
          'send_ok',
          'send_fail',
          'mined_ok',
          'mined_revert',
          'no_receipt',
          'revert_reasons',
          'gas_used',
          'confirm_ms',
          'http_req_duration',
          'http_reqs',
        ],
        OPS
      ),
    ]),
  },
};

export function setup() {
  if (SCEN !== 'A' && (!PROPOSER || APPROVERS.length < THRESHOLD - 1)) {
    throw new Error(
      `SCENARIO=${SCEN} needs PROPOSER + at least ${THRESHOLD - 1} approvers (source loadtest/.experiment.env)`
    );
  }
  const needed = SCEN === 'D' ? 1 : TARGET * ITERATIONS;
  if (POOL.length < needed) {
    throw new Error(`batch pool too small: have ${POOL.length}, need ${needed} (raise POOL in setup-experiment.js)`);
  }
  console.log(`staking: scenario=${SCEN} vus=${TARGET} iterations/vu=${ITERATIONS} pool=${POOL.length}`);
  return {};
}

function who() {
  return ACCOUNTS[(__VU - 1) % ACCOUNTS.length];
}

/** A verifier stakes and attests; the batch then enters its challenge window. */
function scenarioA() {
  const me = ACCOUNTS[0] || who();
  const t0 = Date.now();

  // 1 in 10 verifications pays a fresh deposit, so the stake transaction is
  // measured under load without pretending it is paid per batch.
  if (__ITER % 10 === 0) {
    const dep = sendTx(me, ADDRESSES.VerifierStake, encode('depositStake', []), AMOUNTS.eth1, GAS.standard, 'stake', {
      op: 'stake',
    });
    if (dep.ok) confirm(dep.result, 'stake', { op: 'stake' });
    else scenarioErrors.add(1, { reason: shortReason(dep.error) });
  }

  const mint = sendTx(
    me,
    ADDRESSES.CreditToken,
    encode('mintBatch', [`STK-${Date.now()}-${__VU}`, 'ipfs://staking', AMOUNTS.thousand]),
    null,
    GAS.standard,
    'mint',
    { op: 'mint' }
  );
  if (!mint.ok) {
    scenarioErrors.add(1, { reason: shortReason(mint.error) });
    return;
  }
  const batchId = logId(mint.result, EVENTS.BatchMinted.topic0) || '0x1';
  confirm(mint.result, 'mint', { op: 'mint' });

  call('getChallengeWindow', [batchId], ADDRESSES.VerifierStake, 'read', { op: 'read' });
  call('getVerifierInfo', [me], ADDRESSES.VerifierStake, 'read', { op: 'read' });

  stakeMs.add(Date.now() - t0);
}

/** Submit a challenge and drive it through the regulator panel to resolution. */
function challengeLifecycle(challengerWins) {
  const batchId = POOL[exec.scenario.iterationInTest % POOL.length];
  const challenger = CHALLENGERS[(__VU - 1) % CHALLENGERS.length];
  const t0 = Date.now();

  const chal = sendTx(
    challenger,
    ADDRESSES.VerifierStake,
    encode('createChallenge', [batchId, 'ipfs://challenge-evidence']),
    AMOUNTS.eth01,
    GAS.heavy,
    'challenge',
    { op: 'challenge' }
  );
  if (!chal.ok) {
    scenarioErrors.add(1, { reason: shortReason(chal.error) });
    return;
  }
  const challengeId = logId(chal.result, EVENTS.ChallengeCreated.topic0);
  confirm(chal.result, 'challenge', { op: 'challenge' });
  if (!challengeId) {
    scenarioErrors.add(1, { reason: 'no challengeId' });
    return;
  }
  challengesCreated.add(1);

  // The panel: propose once, then approve until the threshold executes it.
  const prop = sendTx(
    PROPOSER,
    ADDRESSES.RegulatorMultisig,
    encode('proposeResolution', [challengeId, challengerWins]),
    null,
    GAS.heavy,
    'propose',
    { op: 'propose' }
  );
  if (!prop.ok) {
    scenarioErrors.add(1, { reason: shortReason(prop.error) });
    return;
  }
  confirm(prop.result, 'propose', { op: 'propose' });

  for (let i = 0; i < APPROVERS.length; i++) {
    const ap = sendTx(
      APPROVERS[i],
      ADDRESSES.RegulatorMultisig,
      encode('approveResolution', [challengeId]),
      null,
      GAS.heavy,
      'msigApprove',
      { op: 'msig' }
    );
    if (ap.ok) confirm(ap.result, 'msigApprove', { op: 'msig' });
    else scenarioErrors.add(1, { reason: shortReason(ap.error) });
  }

  call('getChallenge', [challengeId], ADDRESSES.VerifierStake, 'read', { op: 'read' });
  challengesResolved.add(1);
  lifecycleMs.add(Date.now() - t0);
}

/** Many challengers pile onto one batch simultaneously. */
function scenarioD() {
  const batchId = POOL[0];
  const challenger = CHALLENGERS[(__VU - 1) % CHALLENGERS.length];
  const chal = sendTx(
    challenger,
    ADDRESSES.VerifierStake,
    encode('createChallenge', [batchId, 'ipfs://concurrent-evidence']),
    AMOUNTS.eth01,
    GAS.heavy,
    'challenge',
    { op: 'challenge' }
  );
  if (chal.ok) {
    confirm(chal.result, 'challenge', { op: 'challenge' });
    challengesCreated.add(1);
  } else {
    scenarioErrors.add(1, { reason: shortReason(chal.error) });
  }
  call('getBatchChallenges', [batchId], ADDRESSES.VerifierStake, 'read', { op: 'read' });
}

export default function () {
  if (SCEN === 'A') scenarioA();
  else if (SCEN === 'B') challengeLifecycle(true);
  else if (SCEN === 'C') challengeLifecycle(false);
  else if (SCEN === 'D') scenarioD();
  else throw new Error(`unknown SCENARIO=${SCEN}`);

  sleep(0.05);
}
