/**
 * Shared journey fragments for R3 (mixed) and R7 (ramp).
 * The standalone R1/R2 scripts keep their own copies so each can be run alone.
 */
import { call, sendTx, encode, confirm, shortReason, AMT, AMOUNTS, ADDRESSES, rpc, EVENTS } from './lib.js';
import { Counter } from 'k6/metrics';

export const flowErrors = new Counter('flow_errors_by_reason');

export function readBatch(batchId, listingId, who) {
  call('totalSupply', [], ADDRESSES.CreditToken, 'read');
  call('getBatchInfo', [batchId], ADDRESSES.CreditToken, 'read');
  call('getUserBatchBalance', [batchId, who], ADDRESSES.CreditToken, 'read');
  call('getListing', [listingId], ADDRESSES.Marketplace, 'read');
  call('getActiveListings', [], ADDRESSES.Marketplace, 'read');
  rpc('eth_blockNumber', [], 'read');
}

function listingIdFromReceipt(hash) {
  const r = rpc('eth_getTransactionReceipt', [hash], 'receipt');
  if (!r.ok || !r.result || !r.result.logs) return null;
  for (const log of r.result.logs) {
    if ((log.topics || [])[0] === EVENTS.ListingCreated.topic0) {
      return '0x' + log.topics[1].slice(2).replace(/^0+/, '');
    }
  }
  return null;
}

/** buy → list → cancel, from `who`. */
export function writeCycle(who, batchId, listingId, priceHex) {
  const buy = sendTx(
    who,
    ADDRESSES.Marketplace,
    encode('buyTokens', [listingId, AMT.one]),
    AMOUNTS.eth001,
    '0x1e8480',
    'buy'
  );
  if (!buy.ok) {
    flowErrors.add(1, { reason: shortReason(buy.error) });
    return;
  }
  confirm(buy.result, 'buy');

  const list = sendTx(
    who,
    ADDRESSES.Marketplace,
    encode('createListing', [batchId, AMT.half, priceHex]),
    null,
    '0x1e8480',
    'createListing'
  );
  if (!list.ok) {
    flowErrors.add(1, { reason: shortReason(list.error) });
    return;
  }
  const rec = confirm(list.result, 'createListing');
  if (rec.status !== 1) return;

  const id = listingIdFromReceipt(list.result);
  if (!id) return;
  const cancel = sendTx(
    who,
    ADDRESSES.Marketplace,
    encode('cancelListing', [id]),
    null,
    '0x1e8480',
    'cancelListing'
  );
  if (!cancel.ok) flowErrors.add(1, { reason: shortReason(cancel.error) });
  else confirm(cancel.result, 'cancelListing');
}
