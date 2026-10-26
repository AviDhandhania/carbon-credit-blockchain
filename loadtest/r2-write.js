/**
 * R2 — write storm.
 *
 * Realistic buy → list → cancel cycle per virtual user, each VU on its own
 * funded account (5 accounts, so 5 VUs; more VUs than accounts would measure
 * nonce contention, which is R5's job).
 *
 * eth_sendTransaction returns only a tx hash, so the listing id is recovered
 * from the ListingCreated log in the receipt (topics[1] — the id is indexed).
 *
 *   k6 run loadtest/r2-write.js
 */
import { sleep } from 'k6';
import { Counter } from 'k6/metrics';
import {
  ADDRESSES,
  sendTx,
  encode,
  confirm,
  shortReason,
  rpc,
  AMT,
  AMOUNTS,
  EVENTS,
} from './lib.js';

const BATCH_A = __ENV.BATCH_A || '1';
const PRICE = __ENV.PRICE_HEX || '0x38d7ea4c68000';
const ACCOUNTS = [__ENV.ACC1, __ENV.ACC2, __ENV.ACC3, __ENV.ACC4, __ENV.ACC5].filter(Boolean);

export const txErrors = new Counter('tx_errors_by_reason');
export const cancels = new Counter('listing_cancels');

export const options = {
  scenarios: {
    write_storm: {
      executor: 'constant-vus',
      vus: Math.min(5, Math.max(1, ACCOUNTS.length)),
      duration: __ENV.DURATION || '90s',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<500'],
  },
};

/** listing id out of the first ListingCreated log, or null */
function listingIdFromReceipt(hash) {
  const r = rpc('eth_getTransactionReceipt', [hash], 'receipt');
  if (!r.ok || !r.result || !r.result.logs) return null;
  for (const log of r.result.logs) {
    if ((log.topics || [])[0] === EVENTS.ListingCreated.topic0) {
      return '0x' + log.topics[1].slice(2).replace(/^0+/, '') || '0x0';
    }
  }
  return null;
}

export default function () {
  const me = ACCOUNTS[(__VU - 1) % ACCOUNTS.length];

  // 1. buy 1 CC from listing A (0.001 ETH at the seeded price)
  const buy = sendTx(
    me,
    ADDRESSES.Marketplace,
    encode('buyTokens', [__ENV.LISTING_A || '1', AMT.one]),
    AMOUNTS.eth001,
    '0x1e8480',
    'buy'
  );
  if (!buy.ok) {
    txErrors.add(1, { reason: shortReason(buy.error) });
    return;
  }
  confirm(buy.result, 'buy');

  // 2. list half a credit
  const list = sendTx(
    me,
    ADDRESSES.Marketplace,
    encode('createListing', [BATCH_A, AMT.half, PRICE]),
    null,
    '0x1e8480',
    'createListing'
  );
  if (!list.ok) {
    txErrors.add(1, { reason: shortReason(list.error) });
    return;
  }
  const listReceipt = confirm(list.result, 'createListing');
  if (listReceipt.status !== 1) return;

  // 3. cancel it again
  const listingId = listingIdFromReceipt(list.result);
  if (listingId) {
    const cancel = sendTx(
      me,
      ADDRESSES.Marketplace,
      encode('cancelListing', [listingId]),
      null,
      '0x1e8480',
      'cancelListing'
    );
    if (cancel.ok) {
      cancels.add(1);
      confirm(cancel.result, 'cancelListing');
    } else {
      txErrors.add(1, { reason: shortReason(cancel.error) });
    }
  }

  sleep(0.3);
}
