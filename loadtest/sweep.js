/**
 * SWEEP — the workload-level experiment (specification §4, §5, §6).
 *
 * One parameterized run covers an entire workload level:
 *
 *   TARGET_VUS   concurrent virtual users          (report: 10/50/100/250/500/1000)
 *   WARMUP       seconds of ramp 0 -> TARGET_VUS   (default 60s)
 *   MEASURE      seconds held at TARGET_VUS        (default 180s)
 *   COOLDOWN     seconds of ramp TARGET_VUS -> 0   (default 30s)
 *
 * Every request is tagged with `phase` (warmup|measure|cooldown) and `op`, so
 * the report can quote measurement-window percentiles instead of diluting them
 * with the ramp — which is what "warm-up 1–2 min, measurement 5–10 min" means.
 *
 * The actor mix is a read-dominant mix of operations that actually exist in the
 * implementation (specification §3): 78% readers, 20% traders, 2% retire-and-
 * certify. No operation is invented — there is no on-chain project-submission
 * API in the product contracts, and this scenario does not pretend otherwise.
 *
 * State is prepared in setup(), which runs once per test, so every repetition of
 * every level starts from a fresh, deep listing instead of inheriting whatever
 * the previous run drained (the first suite's soak mistake — finding H-7).
 *
 *   TARGET_VUS=50 WARMUP=60s MEASURE=180s COOLDOWN=30s \
 *     bash -c 'set -a; . loadtest/.state.env; set +a; \
 *       "/c/Program Files/k6/k6.exe" run loadtest/sweep.js'
 */
import { sleep } from 'k6';
import {
  call,
  sendTx,
  encode,
  confirm,
  logId,
  rpc,
  shortReason,
  ADDRESSES,
  AMT,
  AMOUNTS,
  GAS,
  EVENTS,
  phase,
  enableGroups,
  opGroups,
  phaseGroups,
} from './lib.js';

const TARGET = Number(__ENV.TARGET_VUS || 10);
const WARMUP = __ENV.WARMUP || '60s';
const MEASURE = __ENV.MEASURE || '180s';
const COOLDOWN = __ENV.COOLDOWN || '30s';

/**
 * SHAPE picks the stage profile. All four shapes run the same journey mix, so
 * the stress/spike/endurance results are directly comparable with the sweep.
 *
 *   sweep      0 -> TARGET, hold, back to 0        (the workload levels, §4/§5)
 *   stress     10 -> 50 -> 100 -> 250 -> 500 -> 1000 (the saturation hunt, §13)
 *   spike      50 -> 500 -> 50                     (sudden burst, §14)
 *   endurance  100 for 30 minutes                  (sustained run, §15)
 */
const SHAPE = __ENV.SHAPE || 'sweep';
const WARMUP_MS = Number(String(WARMUP).replace(/[^0-9.]/g, '')) * 1000;
const MEASURE_MS = Number(String(MEASURE).replace(/[^0-9.]/g, '')) * 1000;

const ACCOUNTS = [__ENV.ACC1, __ENV.ACC2, __ENV.ACC3, __ENV.ACC4, __ENV.ACC5].filter(Boolean);
const PRICE = __ENV.PRICE_HEX || AMOUNTS.eth001; // 0.001 ETH per whole credit
const SEED_CC = __ENV.SEED_CC || '200000'; // credits in the listing this run drains

/** 1e18-scaled amount as a 0x-hex wei string (BigInt stringification is decimal!). */
function wei(whole) {
  return '0x' + (BigInt(whole) * 10n ** 18n).toString(16);
}

const OPS = ['read', 'buy', 'retire', 'approve', 'mint', 'list'];
const PHASES = ['warmup', 'measure', 'cooldown'];

const SHAPES = {
  sweep: [
    { duration: WARMUP, target: TARGET },
    { duration: MEASURE, target: TARGET },
    { duration: COOLDOWN, target: 0 },
  ],
  // §13: step up and hold at each rung so each plateau is measurable.
  stress: [
    { duration: '30s', target: 10 },
    { duration: '60s', target: 10 },
    { duration: '30s', target: 50 },
    { duration: '60s', target: 50 },
    { duration: '30s', target: 100 },
    { duration: '60s', target: 100 },
    { duration: '30s', target: 250 },
    { duration: '60s', target: 250 },
    { duration: '30s', target: 500 },
    { duration: '60s', target: 500 },
    { duration: '30s', target: 1000 },
    { duration: '60s', target: 1000 },
    { duration: '30s', target: 0 },
  ],
  // §14: 50 -> 500 -> 50, with a hold on each side of the burst.
  spike: [
    { duration: '60s', target: 50 },
    { duration: '120s', target: 50 },
    { duration: '10s', target: 500 },
    { duration: '180s', target: 500 },
    { duration: '10s', target: 50 },
    { duration: '180s', target: 50 },
    { duration: '10s', target: 0 },
  ],
  // §15: 100 concurrent users for 30 minutes, looking for creep/exhaustion.
  endurance: [
    { duration: '60s', target: 100 },
    { duration: '1740s', target: 100 },
    { duration: '60s', target: 0 },
  ],
};

export const options = {
  scenarios: {
    sweep: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: SHAPES[SHAPE] || SHAPES.sweep,
      gracefulRampDown: '10s',
    },
  },
  thresholds: {
    // --- real budgets (carried over from the first suite; NOT relaxed) ------
    http_req_failed: ['rate<0.01'],
    rpc_ok: ['rate>0.99'],
    // --- report groups: always-true, they only enable aggregation ----------
    ...enableGroups([
      'http_req_duration',
      'http_reqs',
      ...phaseGroups(['http_req_duration', 'http_reqs', 'http_req_failed'], PHASES),
      ...opGroups(['http_req_duration', 'http_reqs'], ['read', 'buy', 'retire', 'approve']),
      ...opGroups(['rpc_ok', 'send_ok', 'send_fail', 'mined_ok', 'mined_revert', 'no_receipt', 'revert_reasons', 'gas_used', 'confirm_ms'], OPS),
      'http_req_duration{op:read,phase:measure}',
      'http_req_duration{op:buy,phase:measure}',
      'http_req_duration{op:retire,phase:measure}',
      'gas_used{op:mint}',
      'gas_used{op:list}',
    ]),
  },
};

/** Runs once, before the VUs start. Returns the ids the VUs consume. */
export function setup() {
  const seller = ACCOUNTS[0] || __ENV.DEPLOYER;
  if (!seller) throw new Error('sweep.js needs ACC1..ACC5 in the environment (source loadtest/.state.env)');

  const mint = sendTx(
    seller,
    ADDRESSES.CreditToken,
    encode('mintBatch', [`SWEEP-${Date.now()}`, 'ipfs://sweep', wei(SEED_CC)]),
    null,
    GAS.standard,
    'mint',
    { op: 'mint' }
  );
  if (!mint.ok) throw new Error('setup mintBatch failed: ' + shortReason(mint.error));
  const batchId = logId(mint.result, EVENTS.BatchMinted.topic0);
  confirm(mint.result, 'mint', { op: 'mint' });

  const appr = sendTx(
    seller,
    ADDRESSES.CreditToken,
    encode('approve', [ADDRESSES.Marketplace, wei(SEED_CC)]),
    null,
    GAS.approve,
    'approve',
    { op: 'approve' }
  );
  if (!appr.ok) throw new Error('setup approve failed: ' + shortReason(appr.error));
  confirm(appr.result, 'approve', { op: 'approve' });

  const list = sendTx(
    seller,
    ADDRESSES.Marketplace,
    encode('createListing', [batchId, wei(SEED_CC), PRICE]),
    null,
    GAS.standard,
    'list',
    { op: 'list' }
  );
  if (!list.ok) throw new Error('setup createListing failed: ' + shortReason(list.error));
  const listingId = logId(list.result, EVENTS.ListingCreated.topic0);
  confirm(list.result, 'list', { op: 'list' });

  // Each actor gets its own retirement batch. Marketplace.buyTokens moves the
  // seller's *oldest* credits (CreditToken._update walks the seller's batch
  // list), not necessarily the batch named by the listing, so a buyer cannot
  // rely on holding the listed batch. Retiring a batch minted to the actor
  // itself makes the 2% retirement share deterministic instead of measuring
  // "insufficient batch balance" rejections.
  const retireBatches = ACCOUNTS.map((acct) => {
    const seed = sendTx(
      acct,
      ADDRESSES.CreditToken,
      encode('mintBatch', [
        `RETIRE-${acct.slice(2, 8)}-${Date.now()}`,
        'ipfs://retire-seed',
        wei(100000),
      ]),
      null,
      GAS.standard,
      'mint',
      { op: 'mint' }
    );
    if (!seed.ok) throw new Error('retire seed mint failed: ' + shortReason(seed.error));
    const id = logId(seed.result, EVENTS.BatchMinted.topic0);
    confirm(seed.result, 'mint', { op: 'mint' });
    return id;
  });

  console.log(
    `sweep setup: batch=${batchId} listing=${listingId} (${SEED_CC} CC @ ${PRICE}); ` +
      `retire batches=${retireBatches.join(',')}`
  );
  return { batchId, listingId, retireBatches };
}

function whoIndex() {
  return (__VU - 1) % ACCOUNTS.length;
}

function who() {
  return ACCOUNTS[whoIndex()];
}

function reader(ph, ids) {
  call('totalSupply', [], ADDRESSES.CreditToken, 'read', { op: 'read', phase: ph });
  call('getBatchInfo', [ids.batchId], ADDRESSES.CreditToken, 'read', { op: 'read', phase: ph });
  call('getBatchSupply', [ids.batchId], ADDRESSES.CreditToken, 'read', { op: 'read', phase: ph });
  call('getUserBatchBalance', [ids.batchId, who()], ADDRESSES.CreditToken, 'read', { op: 'read', phase: ph });
  call('getListing', [ids.listingId], ADDRESSES.Marketplace, 'read', { op: 'read', phase: ph });
  call('getActiveListings', [], ADDRESSES.Marketplace, 'read', { op: 'read', phase: ph });
  call('getUserCertificates', [who()], ADDRESSES.RetireAndCertify, 'read', { op: 'read', phase: ph });
  call('getVerifierInfo', [who()], ADDRESSES.VerifierStake, 'read', { op: 'read', phase: ph });
  rpc('eth_blockNumber', [], 'read', { op: 'read', phase: ph });
}

function trader(ph, ids) {
  const me = who();
  const buy = sendTx(
    me,
    ADDRESSES.Marketplace,
    encode('buyTokens', [ids.listingId, AMT.one]),
    AMOUNTS.eth001,
    GAS.standard,
    'buy',
    { op: 'buy', phase: ph }
  );
  if (buy.ok) confirm(buy.result, 'buy', { op: 'buy' });
  call('balanceOf', [me], ADDRESSES.CreditToken, 'read', { op: 'read', phase: ph });
}

function retireR(ph, ids) {
  const me = who();
  const batchId = ids.retireBatches[whoIndex()];

  // The retirement flow is approve -> retireAndCertify (finding F-2): the
  // RetireAndCertify contract pulls the tokens, so it needs an allowance first.
  const appr = sendTx(
    me,
    ADDRESSES.CreditToken,
    encode('approve', [ADDRESSES.RetireAndCertify, AMT.thousand]),
    null,
    GAS.approve,
    'approve',
    { op: 'approve', phase: ph }
  );
  if (!appr.ok) return;
  confirm(appr.result, 'approve', { op: 'approve' });

  // GAS.heavy, not GAS.standard: _retireBatch re-sums the holder's whole batch
  // list, so cost grows with the number of batches that account has ever held.
  // With the 400-batch experiment pool a retirement needs ~2.35M gas; the 2M
  // "standard" limit made Hardhat reject every send (send_fail, no receipt),
  // which is why the earlier suite recorded 0 retirements.
  const ret = sendTx(
    me,
    ADDRESSES.RetireAndCertify,
    encode('retireAndCertify', [batchId, AMT.quarter, 'ipfs://sweep-cert']),
    null,
    GAS.heavy,
    'retire',
    { op: 'retire', phase: ph }
  );
  if (ret.ok) confirm(ret.result, 'retire', { op: 'retire' });
}

export default function (ids) {
  // Only the sweep shape has warm-up/measurement/cool-down windows; the stress,
  // spike and endurance shapes are whole-run measurements, so their traffic is
  // tagged as measurement rather than being split at arbitrary boundaries.
  const ph = SHAPE === 'sweep' ? phase(WARMUP_MS, MEASURE_MS) : 'measure';

  // Mix per iteration, not per virtual user: assigning the role once per VU
  // meant retirement only ran on VUs that happened to land in the 2 % band
  // (users 21 and 42 of every hundred), so the 10-user level never retired at
  // all. The iteration counter keeps the choice reproducible and decorrelated
  // from VU order: 78% readers, 20% traders, 2% retire-and-certify.
  const r = (__VU * 7919 + __ITER * 104729) % 100;
  if (r < 78) reader(ph, ids);
  else if (r < 98) trader(ph, ids);
  else retireR(ph, ids);

  sleep(0.2);
}
