/**
 * R1 — read storm.
 *
 * The load a dashboard open in many tabs produces: pure eth_call traffic
 * against the same views the panels poll on mount.
 *
 *   k6 run loadtest/r1-read.js
 */
import { check, sleep } from 'k6';
import { call, ADDRESSES, rpc } from './lib.js';

const BATCH_A = __ENV.BATCH_A || '1';
const LISTING_A = __ENV.LISTING_A || '1';
const ACC1 = __ENV.ACC1 || '0x';

// TARGET_VUS / DURATION let R1 double as the read-only control for R7, which is
// how we tell a read-path bottleneck from a write/automine one.
const TARGET = Number(__ENV.TARGET_VUS || 25);
const HOLD = __ENV.DURATION || '30s';

export const options = {
  scenarios: {
    read_storm: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: TARGET },
        { duration: HOLD, target: TARGET },
      ],
      gracefulRampDown: '5s',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<250'],
    rpc_ok: ['rate>0.99'],
  },
};

export default function () {
  const a = call('totalSupply', [], ADDRESSES.CreditToken, 'read');
  check(a, { 'totalSupply ok': (r) => r.ok });

  const b = call('getBatchInfo', [BATCH_A], ADDRESSES.CreditToken, 'read');
  check(b, { 'getBatchInfo ok': (r) => r.ok });

  call('getBatchSupply', [BATCH_A], ADDRESSES.CreditToken, 'read');
  call('getUserBatchBalance', [BATCH_A, ACC1], ADDRESSES.CreditToken, 'read');
  call('getListing', [LISTING_A], ADDRESSES.Marketplace, 'read');

  // Heavier views, as the panels also poll these.
  call('getActiveListings', [], ADDRESSES.Marketplace, 'read');
  call('getVerifierInfo', [ACC1], ADDRESSES.VerifierStake, 'read');
  rpc('eth_blockNumber', [], 'read');

  check(a, { 'chain responding': (r) => r.httpStatus === 200 });
  sleep(0.2);
}
