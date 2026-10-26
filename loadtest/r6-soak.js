/**
 * R6 — soak: low-rate realistic journeys for a sustained window.
 *
 * Each VU buys 1 CC from listing A and immediately retires 0.5 CC into a
 * soulbound certificate. Watches for slow degradation: rising latency, rising
 * error rate, growing node memory, and the point where a listing runs dry
 * (which is a UX state, not a bug: the UI has to cope with it).
 *
 *   k6 run loadtest/r6-soak.js
 */
import { sleep, check } from 'k6';
import { Counter } from 'k6/metrics';
import { ADDRESSES, sendTx, encode, confirm, shortReason, call, rpc, AMT, AMOUNTS } from './lib.js';

const BATCH_A = __ENV.BATCH_A || '1';
const LISTING_A = __ENV.LISTING_A || '1';
const ACCOUNTS = [__ENV.ACC3, __ENV.ACC4, __ENV.ACC5].filter(Boolean);

export const retires = new Counter('certificates_minted');
export const soakErrors = new Counter('soak_errors_by_reason');

export const options = {
  scenarios: {
    soak: {
      executor: 'constant-vus',
      vus: Math.min(3, Math.max(1, ACCOUNTS.length)),
      duration: __ENV.DURATION || '300s',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<500'],
  },
};

let failLogs = 0;
function noteFailure(reason) {
  if (failLogs < 8) {
    console.log(`SOAK FAIL: ${reason}`);
    failLogs++;
  }
}

export default function () {
  const me = ACCOUNTS[(__VU - 1) % ACCOUNTS.length];

  // Retirement is a two-transaction flow: the holder must give the
  // RetireAndCertify contract an ERC-20 allowance first (mirrors the UI's
  // approve-then-retire). We only top the allowance up when it runs short, so
  // the expensive path is measured, not stepped on.
  if (!hasAllowance(me)) {
    const approve = sendTx(
      me,
      ADDRESSES.CreditToken,
      encode('approve', [ADDRESSES.RetireAndCertify, AMT.thousand]),
      null,
      '0x1e8480',
      'approve'
    );
    if (!approve.ok) {
      soakErrors.add(1, { reason: shortReason(approve.error) });
      return;
    }
    confirm(approve.result, 'approve');
  }

  const buy = sendTx(
    me,
    ADDRESSES.Marketplace,
    encode('buyTokens', [LISTING_A, AMT.one]),
    AMOUNTS.eth001,
    '0x1e8480',
    'buy'
  );
  if (!buy.ok) {
    const why = shortReason(buy.error);
    soakErrors.add(1, { reason: why });
    noteFailure('buy: ' + why);
  } else {
    const br = confirm(buy.result, 'buy');
    if (br.status === 1) {
      const retire = sendTx(
        me,
        ADDRESSES.RetireAndCertify,
        encode('retireAndCertify', [BATCH_A, AMT.half, 'ipfs://loadtest-cert']),
        null,
        '0x1e8480',
        'retire'
      );
      if (retire.ok) {
        const rr = confirm(retire.result, 'retire');
        if (rr.status === 1) retires.add(1);
        else {
          soakErrors.add(1, { reason: 'retire reverted' });
          noteFailure('retire reverted (status 0)');
        }
      } else {
        const why = shortReason(retire.error);
        soakErrors.add(1, { reason: why });
        noteFailure('retire: ' + why);
      }
    }
  }

  // A cheap read so soak latency is sampled even when buys fail.
  const sup = call('totalSupply', [], ADDRESSES.CreditToken, 'read');
  check(sup, { 'supply readable': (r) => r.ok });
  rpc('eth_blockNumber', [], 'read');

  sleep(0.5);
}

/** 64-char lowercase hex, so plain string comparison equals numeric order */
function pad64(h) {
  return String(h).replace(/^0x/, '').toLowerCase().padStart(64, '0');
}

/** true when `who` already lets RetireAndCertify move at least 0.5 CC */
function hasAllowance(who) {
  const r = call('allowance', [who, ADDRESSES.RetireAndCertify], ADDRESSES.CreditToken, 'read');
  if (!r.ok || typeof r.result !== 'string') return false;
  return pad64(r.result) >= pad64('0x6f05b59d3b20000'); // 0.5 CC
}
