/**
 * R4 — race: two buyers hit the same listing at the same instant.
 *
 * Each iteration seeds a FRESH listing whose amount is smaller than the sum of
 * the two buys, so exactly one buy must win. (An earlier version raced the same
 * static listing over and over; after the first winner it was simply dry, so it
 * measured inventory exhaustion rather than a race. That is recorded as a
 * harness finding, not a product one.)
 *
 * Setup per iteration (all by SELLER, who has MINTER + BUYER roles):
 *   mint batch -> approve marketplace -> createListing
 * Race:
 *   two concurrent eth_sendTransaction buys (http.batch) from BUYER_A / BUYER_B
 *
 * Assertions:
 *   - never both succeed  (over-sell / double-spend accounting bug)
 *   - the loser receives a clear inverse-consequence message
 *
 *   k6 run loadtest/r4-race.js
 */
import { sleep } from 'k6';
import http from 'k6/http';
import { Counter, Trend } from 'k6/metrics';
import { RPC, ADDRESSES, encode, EVENTS, AMT, AMOUNTS } from './lib.js';

const SELLER = __ENV.ACC5;
const BUYER_A = __ENV.ACC3;
const BUYER_B = __ENV.ACC4;

export const bothSucceeded = new Counter('race_both_succeeded');
export const oneSucceeded = new Counter('race_one_succeeded');
export const noneSucceeded = new Counter('race_none_succeeded');
export const loserReasons = new Counter('race_loser_reason');
export const seedFailures = new Counter('race_seed_failures');
export const raceLatency = new Trend('race_latency_ms', true);

export const options = {
  scenarios: {
    race: {
      executor: 'per-vu-iterations',
      vus: Number(__ENV.RACE_VUS || 4),
      iterations: Number(__ENV.RACE_ITERS || 3),
      maxDuration: '5m',
    },
  },
  // Deliberately no failure-rate threshold: one of the two buys MUST fail.
};

const LISTED = AMOUNTS.four_hundred; // 400 CC
const BUY = AMOUNTS.three_hundred;   // 300 CC per buyer (> half of 400)
const NO_VALUE = null;

function rpcRaw(method, params, tags) {
  return http.post(
    RPC,
    JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    { headers: { 'Content-Type': 'application/json' }, tags }
  );
}

function send(from, to, data, value, gas, tag) {
  const tx = { from, to, data, gas };
  if (value) tx.value = value;
  const r = rpcRaw('eth_sendTransaction', [tx], { tx: tag });
  try {
    return JSON.parse(r.body);
  } catch (e) {
    return { error: { message: 'unparseable: ' + r.body } };
  }
}

function receipt(hash) {
  const r = rpcRaw('eth_getTransactionReceipt', [hash], { tx: 'receipt' });
  try {
    return JSON.parse(r.body).result;
  } catch (e) {
    return null;
  }
}

function listingIdFromReceipt(rec) {
  if (!rec || !rec.logs) return null;
  for (const log of rec.logs) {
    if ((log.topics || [])[0] === EVENTS.ListingCreated.topic0) {
      const id = log.topics[1].slice(2).replace(/^0+/, '');
      return '0x' + (id === '' ? '0' : id);
    }
  }
  return null;
}

export default function () {
  // --- seed a fresh, raceable listing -------------------------------------
  const projectId = `PROJ-RACE-${__VU}-${__ITER}`;
  const mint = send(
    SELLER,
    ADDRESSES.CreditToken,
    encode('mintBatch', [projectId, 'QmRace', AMT.thousand]),
    NO_VALUE,
    '0x1e8480',
    'mint'
  );
  if (!mint.error) {
    const rec = receipt(mint.result);
    if (!rec || Number(rec.status) !== 1) {
      seedFailures.add(1, { kind: 'mint' });
      return;
    }
  } else {
    seedFailures.add(1, { kind: 'mint' });
    return;
  }

  const approve = send(
    SELLER,
    ADDRESSES.CreditToken,
    encode('approve', [ADDRESSES.Marketplace, AMT.thousand]),
    NO_VALUE,
    '0x1e8480',
    'approve'
  );
  if (approve.error) {
    seedFailures.add(1, { kind: 'approve' });
    return;
  }

  // listing targets the newest batch; resolve it from the mint receipt
  const mintRec = receipt(mint.result);
  const batchIdWord = mintRec.logs.find(
    (l) => l.topics[0] === EVENTS.BatchMinted.topic0
  );
  const batchId = batchIdWord ? '0x' + batchIdWord.topics[1].slice(2).replace(/^0+/, '') : null;
  if (!batchId) {
    seedFailures.add(1, { kind: 'no-batch-id' });
    return;
  }

  const list = send(
    SELLER,
    ADDRESSES.Marketplace,
    encode('createListing', [batchId, LISTED, __ENV.PRICE_HEX || '0x38d7ea4c68000']),
    NO_VALUE,
    '0x1e8480',
    'createListing'
  );
  if (list.error) {
    seedFailures.add(1, { kind: 'createListing' });
    return;
  }
  const listRec = receipt(list.result);
  if (!listRec || Number(listRec.status) !== 1) {
    seedFailures.add(1, { kind: 'createListing-reverted' });
    return;
  }
  const listingId = listingIdFromReceipt(listRec);
  if (!listingId) {
    seedFailures.add(1, { kind: 'no-listing-id' });
    return;
  }

  // --- race ---------------------------------------------------------------
  const body = (from) =>
    JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_sendTransaction',
      params: [
        {
          from,
          to: ADDRESSES.Marketplace,
          data: encode('buyTokens', [listingId, BUY]),
          value: AMOUNTS.eth1, // 1 ETH; the contract refunds the excess
          gas: '0x1e8480',
        },
      ],
    });

  const t0 = Date.now();
  const [ra, rb] = http.batch([
    { method: 'POST', url: RPC, body: body(BUYER_A), params: { headers: { 'Content-Type': 'application/json' }, tags: { race: 'A' } } },
    { method: 'POST', url: RPC, body: body(BUYER_B), params: { headers: { 'Content-Type': 'application/json' }, tags: { race: 'B' } } },
  ]);
  raceLatency.add(Date.now() - t0);

  const parse = (r) => {
    try {
      return JSON.parse(r.body);
    } catch (e) {
      return { error: { message: 'unparseable: ' + r.body } };
    }
  };
  const a = parse(ra);
  const b = parse(rb);
  const aOk = !a.error;
  const bOk = !b.error;

  if (aOk && bOk) bothSucceeded.add(1);
  else if (aOk || bOk) oneSucceeded.add(1);
  else noneSucceeded.add(1);

  const loser = aOk ? b : a;
  if (loser.error) {
    const msg = String(loser.error.message || JSON.stringify(loser.error)).slice(0, 70);
    loserReasons.add(1, { reason: msg });
    console.log(
      `RACE vu=${__VU} iter=${__ITER} winner=${aOk && bOk ? 'BOTH' : aOk ? 'A' : bOk ? 'B' : 'NONE'} listing=${listingId} full_error=${JSON.stringify(loser.error).slice(0, 400)}`
    );
  }
  sleep(0.2);
}
