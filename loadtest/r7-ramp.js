/**
 * R7 — ramp: push the stack until the p95 budget breaks.
 *
 * 0 → 50 VUs over 5 minutes, 45 of them readers plus writers pinned to the 5
 * role-bearing accounts (that ceiling is itself a finding — see the report).
 *
 *   k6 run loadtest/r7-ramp.js
 */
import { sleep } from 'k6';
import { readBatch, writeCycle } from './flows.js';

const BATCH_A = __ENV.BATCH_A || '1';
const LISTING_A = __ENV.LISTING_A || '1';
const PRICE = __ENV.PRICE_HEX || '0x38d7ea4c68000';
const ACCOUNTS = [__ENV.ACC1, __ENV.ACC2, __ENV.ACC3, __ENV.ACC4, __ENV.ACC5].filter(Boolean);

export const options = {
  scenarios: {
    ramp: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '120s', target: 25 },
        { duration: '120s', target: 50 },
        { duration: '60s', target: 50 },
      ],
      gracefulRampDown: '10s',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.02'],
    http_req_duration: ['p(95)<1000'],
  },
};

export default function () {
  const me = ACCOUNTS[(__VU - 1) % ACCOUNTS.length];
  readBatch(BATCH_A, LISTING_A, me);

  // one writer per 10 VUs
  if (__VU % 10 === 1 && me) writeCycle(me, BATCH_A, LISTING_A, PRICE);

  sleep(0.2);
}
