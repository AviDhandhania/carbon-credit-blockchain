/**
 * R5 — nonce contention.
 *
 * Every VU transacts from the SAME account, so concurrent eth_sendTransaction
 * calls race on one nonce sequence. This is the classic dApp failure mode
 * (double-click, two tabs, a retry loop) and it is the k6-side mirror of the
 * ethers-v6 nonce-cache workaround already noted in verify-integration.mjs.
 *
 * Expected: errors. The point is to measure how often, and what they say.
 *
 *   k6 run loadtest/r5-nonce.js
 */
import { sleep } from 'k6';
import { Counter } from 'k6/metrics';
import { ADDRESSES, sendTx, encode, confirm, shortReason, AMT } from './lib.js';

const WHO = __ENV.ACC1;
const BATCH_A = __ENV.BATCH_A || '1';

export const nonceErrors = new Counter('nonce_errors');
export const otherErrors = new Counter('other_errors');
export const accepted = new Counter('tx_accepted');

export const options = {
  scenarios: {
    same_account: {
      executor: 'constant-vus',
      vus: Number(__ENV.VUS || 5),
      duration: __ENV.DURATION || '60s',
    },
  },
  // No thresholds on purpose: this scenario is probing a failure mode.
};

export default function () {
  const tx = sendTx(
    WHO,
    ADDRESSES.CreditToken,
    encode('mintBatch', ['PROJ-R5', 'QmR5', AMT.one]),
    null,
    '0x1e8480',
    'mint'
  );
  if (tx.ok) {
    accepted.add(1);
    confirm(tx.result, 'mint');
  } else {
    const reason = shortReason(tx.error);
    if (/nonce/i.test(reason)) nonceErrors.add(1, { reason: reason.slice(0, 40) });
    else otherErrors.add(1, { reason: reason.slice(0, 40) });
  }
  sleep(0.05);
}
