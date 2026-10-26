/**
 * R3 — mixed journey load: R1's read storm and R2's write cycle running at the
 * same time (k6 runs scenarios concurrently), which is the realistic case of
 * users browsing while others transact.
 *
 *   k6 run loadtest/r3-mixed.js
 */
import { sleep } from 'k6';
import { readBatch, writeCycle } from './flows.js';

const BATCH_A = __ENV.BATCH_A || '1';
const LISTING_A = __ENV.LISTING_A || '1';
const PRICE = __ENV.PRICE_HEX || '0x38d7ea4c68000';
const ACCOUNTS = [__ENV.ACC1, __ENV.ACC2, __ENV.ACC3, __ENV.ACC4, __ENV.ACC5].filter(Boolean);

export const options = {
  scenarios: {
    readers: {
      executor: 'ramping-vus',
      exec: 'reader',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 20 },
        { duration: '60s', target: 20 },
      ],
      gracefulRampDown: '5s',
    },
    writers: {
      executor: 'constant-vus',
      exec: 'writer',
      vus: Math.min(5, Math.max(1, ACCOUNTS.length)),
      duration: __ENV.DURATION || '90s',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<500'],
  },
};

export function reader() {
  readBatch(BATCH_A, LISTING_A, ACCOUNTS[2] || ACCOUNTS[0]);
  sleep(0.2);
}

export function writer() {
  const me = ACCOUNTS[(__VU - 1) % ACCOUNTS.length];
  writeCycle(me, BATCH_A, LISTING_A, PRICE);
  sleep(0.3);
}
