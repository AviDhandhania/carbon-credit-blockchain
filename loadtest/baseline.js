/**
 * BASELINE — the §9 comparison between the proposed system and a system without
 * the verifier-staking / challenge mechanism.
 *
 * One scenario file, three modes, identical arrival pattern, so the only thing
 * that changes between arms is the verification mechanism:
 *
 *   MODE=baseline   BaselineVerifier: submitProject -> approveProject (mints)
 *                   No stake, no challenge window, approval is final.
 *
 *   MODE=nostake    CreditToken: mintBatch (the attestation) + read the
 *                   challenge window. This is the proposed contracts with the
 *                   staking layer switched off — the "step comparison" arm.
 *
 *   MODE=stake      CreditToken: mintBatch + a depositStake the verifier must
 *                   have made. The one-time stake is charged amortized
 *                   (STAKE_AMORTIZE verifications per deposit) so a single
 *                   1 ETH bond is not billed as if it were paid per batch.
 *
 * Fixed iteration counts (per-vu-iterations) rather than a time box, so the two
 * arms perform the same number of verification cycles and the comparison is per
 * operation, not per second of a differently-loaded run.
 *
 *   MODE=baseline TARGET_VUS=10 ITERATIONS=20 bash -c 'set -a; . loadtest/.state.env; \
 *     . loadtest/.experiment.env; set +a; "/c/Program Files/k6/k6.exe" run loadtest/baseline.js'
 */
import { sleep } from 'k6';
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

const MODE = __ENV.MODE || 'baseline';
const TARGET = Number(__ENV.TARGET_VUS || 10);
const ITERATIONS = Number(__ENV.ITERATIONS || 20);
const BASELINE_ADDR = __ENV.BASELINE_ADDR || '';
const AMOUNT = '0x' + (BigInt(1000) * 10n ** 18n).toString(16); // 1000 CC per verification
const STAKE_AMORTIZE = Number(__ENV.STAKE_AMORTIZE || 50); // verifications per 1 ETH deposit
const ACCOUNTS = [__ENV.ACC1, __ENV.ACC2, __ENV.ACC3, __ENV.ACC4, __ENV.ACC5].filter(Boolean);

/** verification cycles completed (the k6 `iterations` metric counts these too) */
export const verifications = new Counter('verifications');
export const armErrors = new Counter('arm_errors');
export const verifyLatency = new Trend('verify_latency_ms', true);

const OPS = ['submit', 'approve', 'mint', 'stake', 'read'];

export const options = {
  setupTimeout: '600s',
  scenarios: {
    arm: {
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
      'verify_latency_ms',
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
  if (MODE === 'baseline' && !BASELINE_ADDR) {
    throw new Error('MODE=baseline needs BASELINE_ADDR (source loadtest/.experiment.env)');
  }
  console.log(`baseline arm: mode=${MODE} vus=${TARGET} iterations/vu=${ITERATIONS} (${TARGET * ITERATIONS} verifications)`);
  return { start: Date.now() };
}

function who() {
  return ACCOUNTS[(__VU - 1) % ACCOUNTS.length];
}

function armBaseline() {
  const me = who();
  const t0 = Date.now();

  const sub = sendTx(
    me,
    BASELINE_ADDR,
    encode('baselineSubmitProject', [`BASE-${Date.now()}-${__VU}`, 'ipfs://baseline', AMOUNT]),
    null,
    GAS.standard,
    'submit',
    { op: 'submit' }
  );
  if (!sub.ok) {
    armErrors.add(1, { reason: shortReason(sub.error) });
    return;
  }
  const projectId = logId(sub.result, EVENTS.ProjectSubmitted.topic0);
  confirm(sub.result, 'submit', { op: 'submit' });
  if (!projectId) {
    armErrors.add(1, { reason: 'no projectId' });
    return;
  }

  const appr = sendTx(
    me,
    BASELINE_ADDR,
    encode('baselineApproveProject', [projectId]),
    null,
    GAS.standard,
    'approve',
    { op: 'approve' }
  );
  if (!appr.ok) {
    armErrors.add(1, { reason: shortReason(appr.error) });
    return;
  }
  confirm(appr.result, 'approve', { op: 'approve' });

  // Read back the approval state, as a client would.
  call('baselineIsApproved', [projectId], BASELINE_ADDR, 'read', { op: 'read' });

  verifyLatency.add(Date.now() - t0);
  verifications.add(1);
}

function armProposed(withStake) {
  const me = who();
  const t0 = Date.now();

  // The verifier must be staked. The deposit is amortized over STAKE_AMORTIZE
  // verifications instead of being charged to a single one.
  if (withStake && __ITER % STAKE_AMORTIZE === 0) {
    const dep = sendTx(
      me,
      ADDRESSES.VerifierStake,
      encode('depositStake', []),
      AMOUNTS.eth1,
      GAS.standard,
      'stake',
      { op: 'stake' }
    );
    if (dep.ok) confirm(dep.result, 'stake', { op: 'stake' });
    else armErrors.add(1, { reason: shortReason(dep.error) });
  }

  const mint = sendTx(
    me,
    ADDRESSES.CreditToken,
    encode('mintBatch', [`PROP-${Date.now()}-${__VU}`, 'ipfs://proposed', AMOUNT]),
    null,
    GAS.standard,
    'mint',
    { op: 'mint' }
  );
  if (!mint.ok) {
    armErrors.add(1, { reason: shortReason(mint.error) });
    return;
  }
  confirm(mint.result, 'mint', { op: 'mint' });

  // Read the two views the proposed system adds to a verification: the window
  // that now applies, and the verifier's stake standing.
  const batchId = logId(mint.result, EVENTS.BatchMinted.topic0) || '0x1';
  call('getChallengeWindow', [batchId], ADDRESSES.VerifierStake, 'read', { op: 'read' });
  call('getVerifierInfo', [me], ADDRESSES.VerifierStake, 'read', { op: 'read' });

  verifyLatency.add(Date.now() - t0);
  verifications.add(1);
}

export default function () {
  if (MODE === 'baseline') armBaseline();
  else if (MODE === 'nostake') armProposed(false);
  else if (MODE === 'stake') armProposed(true);
  else throw new Error(`unknown MODE=${MODE}`);
  sleep(0.05);
}
