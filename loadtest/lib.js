/**
 * Shared helpers for the k6 load scenarios.
 *
 * k6's JS runtime has no ethers and no reliable big-number support, so:
 *   - call data is built by the tiny ABI encoder below,
 *   - token amounts are passed as 0x hex strings (see AMT), never as JS numbers,
 *   - transactions are sent with eth_sendTransaction from Hardhat's unlocked
 *     accounts, so no in-test signing is needed.
 *
 * Selectors/addresses come from ./generated-abi.js, which is generated from the
 * frontend's own ABIs — never hard-code one.
 *
 * Two conventions the research-paper scenarios rely on:
 *
 *  1. Every request carries `op` (what the user was doing) and, in the
 *     phased scenarios, `phase` (warm-up | measure | cool-down). k6 only
 *     aggregates tagged sub-metrics when a threshold references the tag, so
 *     `enableGroups()` below exists to turn those groups on — see
 *     enableGroups for why the thresholds it emits are always-true.
 *
 *  2. Send and receipt are counted separately: `send_ok` means the node
 *     accepted the transaction, `tx_mined` means it was included with status 1.
 *     Under saturation those diverge, and the difference is a result.
 */
import http from 'k6/http';
import exec from 'k6/execution';
import { Counter, Rate, Trend } from 'k6/metrics';
import { SELECTORS, TYPES, ADDRESSES, EVENTS, AMOUNTS, GAS } from './generated-abi.js';

export const RPC = __ENV.RPC_URL || 'http://127.0.0.1:8545';
export { ADDRESSES, EVENTS, AMOUNTS, GAS };

// --- metrics ---------------------------------------------------------------
export const txOk = new Counter('tx_ok');
export const txFail = new Counter('tx_fail');
export const txRevert = new Counter('tx_revert');
export const rpcErrors = new Counter('rpc_errors');
export const txLatency = new Trend('tx_latency_ms', true);
export const rpcOkRate = new Rate('rpc_ok');

/** send-level outcomes (the node accepted the signed-ish request) */
export const sendOk = new Counter('send_ok');
export const sendFail = new Counter('send_fail');
/** inclusion-level outcomes (a receipt exists and status == 1) */
export const minedOk = new Counter('mined_ok');
export const minedRevert = new Counter('mined_revert');
export const noReceipt = new Counter('no_receipt');
/** gas per mined transaction, tagged {op}. NOT a time series — k6 would
 * otherwise format 256,457 gas as "4m16s". */
export const gasUsed = new Trend('gas_used', false);
/** wall-clock from send to first observed receipt, tagged {op} */
export const confirmMs = new Trend('confirm_ms', true);
/** revert reasons, tagged {reason} */
export const revertReasons = new Counter('revert_reasons');

// --- hex helpers -----------------------------------------------------------
const ZERO = '0'.repeat(64);

export function isHex(s) {
  return typeof s === 'string' && s.slice(0, 2) === '0x';
}

/** uint256 word. Accepts 0x-hex or a plain integer/bool (ids/counts only). */
export function word(v) {
  if (v === undefined || v === null) throw new Error('word(undefined)');
  if (typeof v === 'boolean') return (v ? '1' : '0').padStart(64, '0');
  let h = isHex(v) ? v.slice(2) : Number(v).toString(16);
  if (h.length > 64) throw new Error(`word overflow: ${v}`);
  return h.padStart(64, '0');
}

/** address word. */
export function addr(a) {
  const h = String(a).replace(/^0x/, '').toLowerCase();
  if (h.length !== 40) throw new Error(`bad address: ${a}`);
  return h.padStart(64, '0');
}

/** ASCII/hex body for an ABI `string` argument. */
function stringBody(s) {
  if (isHex(s)) return s.slice(2);
  let out = '';
  for (let i = 0; i < s.length; i++) out += s.charCodeAt(i).toString(16).padStart(2, '0');
  return out;
}

/** Minimal head/tail ABI encoder for static words + dynamic strings. */
export function encode(name, args) {
  const types = TYPES[name];
  const sel = SELECTORS[name];
  if (!types || !sel) throw new Error(`unknown call: ${name}`);
  if (args.length !== types.length) throw new Error(`${name}: expected ${types.length} args`);

  const headSize = types.length * 32;
  const head = [];
  let tail = '';
  let tailBytes = 0;

  for (let i = 0; i < types.length; i++) {
    const t = types[i];
    const v = args[i];
    if (t === 'string') {
      head.push(word(headSize + tailBytes));
      const body = stringBody(v);
      const len = body.length / 2;
      const pad = (64 - (body.length % 64)) % 64;
      const seg = word(len) + body + '0'.repeat(pad);
      tail += seg;
      tailBytes += seg.length / 2;
    } else if (t === 'address') {
      head.push(addr(v));
    } else {
      head.push(word(v));
    }
  }
  return sel + head.join('') + tail;
}

// --- JSON-RPC --------------------------------------------------------------
function mergeTags(tag, extra) {
  const out = { rpc: tag || 'rpc' };
  if (extra) for (const k of Object.keys(extra)) if (extra[k] !== undefined) out[k] = String(extra[k]);
  return out;
}

/**
 * Raw JSON-RPC call. Returns { ok, result, error, httpStatus, ms }.
 * JSON-RPC errors (reverts!) arrive with HTTP 200, so both layers are checked.
 */
export function rpc(method, params, tag, extra) {
  const res = http.post(
    RPC,
    JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: params || [] }),
    { headers: { 'Content-Type': 'application/json' }, tags: mergeTags(tag, extra) }
  );
  let body = null;
  let parseError = null;
  try {
    body = JSON.parse(res.body);
  } catch (e) {
    parseError = String(e && e.message);
  }
  const rpcErr = body && body.error ? body.error : null;
  const ok = res.status === 200 && rpcErr === null && body !== null;
  // Only tag the rate when a tag was actually supplied: k6 rejects `undefined`
  // tag objects, and the untagged group is the one the budgets assert on.
  if (extra) rpcOkRate.add(ok, extra);
  else rpcOkRate.add(ok);
  if (!ok) rpcErrors.add(1, extra ? { ...extra, method } : { method });
  return {
    ok,
    result: body ? body.result : null,
    error: rpcErr || (parseError ? { message: `unparseable body: ${parseError}` } : null),
    httpStatus: res.status,
    ms: res.timings ? res.timings.duration : 0,
  };
}

/** Read-only call via eth_call. */
export function call(name, args, to, tag, extra) {
  return rpc('eth_call', [{ to: to || ADDRESSES.CreditToken, data: encode(name, args) }, 'latest'], tag, extra);
}

/**
 * Send a transaction from an unlocked Hardhat account.
 * `value` is a 0x-hex wei string. `gas` is a 0x-hex gas limit.
 */
export function sendTx(from, to, data, value, gas, tag, extra) {
  const tx = { from, to, data };
  if (value) tx.value = isHex(value) ? value : '0x' + Number(value).toString(16);
  if (gas) tx.gas = isHex(gas) ? gas : '0x' + Number(gas).toString(16);
  const out = rpc('eth_sendTransaction', [tx], tag || 'send', extra);
  if (out.ok) {
    sendOk.add(1, extra ? { ...extra, tx: tag || 'tx' } : { tx: tag || 'tx' });
    txOk.add(1, { tx: tag || 'tx' });
    txLatency.add(out.ms, { tx: tag || 'tx' });
  } else {
    sendFail.add(1, extra ? { ...extra, tx: tag || 'tx' } : { tx: tag || 'tx' });
    txFail.add(1, { tx: tag || 'tx' });
    // A rejected send is where a revert reason first appears; record it.
    revertReasons.add(1, { reason: shortReason(out.error), op: (extra && extra.op) || tag || 'tx' });
  }
  return out;
}

/** Receipt status: 1 success, 0 reverted, null = no receipt. */
export function receiptStatus(hash) {
  const r = rpc('eth_getTransactionReceipt', [hash], 'receipt');
  if (!r.ok || !r.result) return null;
  return Number(r.result.status);
}

/** Fetch a receipt (raw RPC object), or null. */
export function receipt(hash) {
  const r = rpc('eth_getTransactionReceipt', [hash], 'receipt');
  return r.ok ? r.result : null;
}

/**
 * Confirm a sent tx and record the outcome (including the revert reason).
 * Returns { status, reason, gasUsed }.
 */
export function confirm(hash, tag, extra) {
  const r = rpc('eth_getTransactionReceipt', [hash], 'receipt');
  const op = (extra && extra.op) || tag || 'tx';
  if (!r.ok || !r.result) {
    txFail.add(1, { tx: tag || 'tx', kind: 'no-receipt' });
    noReceipt.add(1, { op });
    return { status: null, reason: 'no receipt', gasUsed: null };
  }
  const status = Number(r.result.status);
  const g = r.result.gasUsed ? parseInt(r.result.gasUsed, 16) : null;
  if (g !== null) gasUsed.add(g, { op });
  // Client-observed confirmation time: the round trip that produced a receipt.
  // With Hardhat automine the block is mined inside the send call, so this is
  // the receipt-fetch cost, not a mempool wait — stated as such in the report.
  confirmMs.add(r.ms, { op });
  if (status === 0) {
    txRevert.add(1, { tx: tag || 'tx' });
    minedRevert.add(1, { op });
    return { status, reason: 'reverted', gasUsed: g };
  }
  minedOk.add(1, { op });
  return { status, reason: null, gasUsed: g };
}

/** First id (topics[1]) of the first log matching `topic0`, as 0x-hex. */
export function logId(hash, topic0) {
  const r = rpc('eth_getTransactionReceipt', [hash], 'receipt');
  if (!r.ok || !r.result || !r.result.logs) return null;
  for (const log of r.result.logs) {
    if ((log.topics || [])[0] === topic0) {
      const h = log.topics[1].slice(2).replace(/^0+/, '');
      return '0x' + (h === '' ? '0' : h);
    }
  }
  return null;
}

/** Short revert reason for counters/tags. */
export function shortReason(err) {
  if (!err) return 'unknown';
  const m = err.message || (err.data ? String(err.data) : '');
  return String(m).slice(0, 80);
}

// Kept as an alias so the scenarios read the same; the values themselves are
// generated (see gen-abi.mjs) rather than hand-written.
export const AMT = AMOUNTS;

/** Standard Hardhat account list; overridable so a different chain works. */
export function accounts() {
  if (__ENV.ACCOUNTS) return __ENV.ACCOUNTS.split(',');
  return null; // caller falls back to eth_accounts
}

export const ZERO_ADDR = '0x' + '0'.repeat(40);
export { ZERO };

// --- phased runs -----------------------------------------------------------

/**
 * Phase of the current iteration, computed from the scenario's own start time
 * rather than a wall clock, so warm-up/measurement/cool-down windows in the
 * report line up with the k6 stages that produced them.
 */
export function phase(warmupMs, measureMs) {
  const t = Date.now() - exec.scenario.startTime;
  if (t < warmupMs) return 'warmup';
  if (t < warmupMs + measureMs) return 'measure';
  return 'cooldown';
}

const COUNTER_METRICS = new Set([
  'send_ok',
  'send_fail',
  'mined_ok',
  'mined_revert',
  'no_receipt',
  'revert_reasons',
  'tx_ok',
  'tx_fail',
  'tx_revert',
  'rpc_errors',
  'certificates_minted',
  'tx_errors_by_reason',
  'soak_errors_by_reason',
  'flow_errors_by_reason',
  'listing_cancels',
  'challenges_created',
  'challenges_resolved',
  'verifications',
  'arm_errors',
  'staking_errors_by_reason',
]);

/**
 * Always-true aggregation expressions for a metric's type.
 *
 * Trends ask for both p(95) and p(99): k6 only computes the percentiles a
 * threshold mentions, so without the p(99) expression the summary export has no
 * p(99) at all — and p(95)/p(99) are the two the report leans on.
 */
function alwaysTrue(ref) {
  const base = String(ref).split('{')[0];
  if (COUNTER_METRICS.has(base) || base === 'http_reqs') return ['count>=0'];
  if (base === 'rpc_ok' || base === 'http_req_failed' || base.endsWith('_rate')) return ['rate>=0'];
  return ['p(95)>=0', 'p(99)>=0'];
}

/**
 * Turn on tagged sub-metric aggregation for the groups the report needs.
 *
 * k6 only emits a tag-grouped sub-metric (e.g. `http_req_duration{phase:measure}`)
 * when some threshold references that exact group. The thresholds produced here
 * are *always true* (`p(95)>=0`, `count>=0`, `rate>=0`), so they only enable the
 * sub-metric and never fail a run. Real pass/fail budgets are added separately
 * by each scenario — deliberately, so enabling a report group can never be
 * mistaken for a performance assertion, and no budget is loosened to make a
 * scenario pass.
 *
 * Tag references must name a value (`{op:buy}`); the bare `{op}` form is not a
 * valid k6 threshold selector.
 *
 * @param {string[]} groups e.g. ['http_req_duration{phase:measure}', 'gas_used{op:buy}']
 */
export function enableGroups(groups) {
  const t = {};
  for (const g of groups) t[g] = alwaysTrue(g);
  return t;
}

/**
 * Every `metric{op:<op>}` report group, for the operations a scenario performs.
 * @param {string[]} metrics base metric names
 * @param {string[]} ops operation tag values
 */
export function opGroups(metrics, ops) {
  const out = [];
  for (const m of metrics) for (const op of ops) out.push(`${m}{op:${op}}`);
  return out;
}

/** Every `metric{phase:<phase>}` report group. */
export function phaseGroups(metrics, phases) {
  const out = [];
  for (const m of metrics) for (const ph of phases) out.push(`${m}{phase:${ph}}`);
  return out;
}

/** Helper: tag object for requests/transactions. */
export function tags(op, ph) {
  const t = { op };
  if (ph) t.phase = ph;
  return t;
}
