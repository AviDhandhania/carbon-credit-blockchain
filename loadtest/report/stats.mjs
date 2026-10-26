#!/usr/bin/env node
/**
 * Aggregates the experiment runs into the statistics the paper reports (§10).
 *
 *   node loadtest/report/stats.mjs
 *
 * Reads loadtest/results/exp/{runs.tsv,provenance.json,*.summary.json,*.resources.csv}
 * and writes:
 *   aggregate.json   grouped, machine-readable (per-rep values + statistics)
 *   aggregate.csv    flat one-row-per-metric-per-group table for graphing
 *   runs.csv         one row per run: through-put, latency, errors, wall time
 *
 * Two kinds of percentile live in the output and are NOT interchangeable:
 *
 *   within_run_p95/p99  a single run's request-latency tail (p(95)/p(99) as k6
 *                       computed them over that run's measurement window)
 *   across_reps_p95     the 95th percentile of the *per-run aggregates* across
 *                       the repetitions — i.e. variation between repetitions,
 *                       which is what §10 asks to be explained rather than hidden
 *
 * Everything is computed from the files on disk; nothing is typed in by hand.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const EXP = join(HERE, '..', 'results', 'exp');

if (!existsSync(join(EXP, 'runs.tsv'))) {
  console.error(`no runs.tsv in ${EXP} — run loadtest/run-experiments.sh first`);
  process.exit(2);
}

const provenance = existsSync(join(EXP, 'provenance.json'))
  ? JSON.parse(readFileSync(join(EXP, 'provenance.json'), 'utf8'))
  : {};

function secsOf(s) {
  const m = String(s).match(/([\d.]+)\s*([smh]?)/);
  if (!m) return 0;
  const n = Number(m[1]);
  return m[2] === 'h' ? n * 3600 : m[2] === 'm' ? n * 60 : n;
}
const WARMUP_S = secsOf(provenance.phases?.warmup || '60s');
const MEASURE_S = secsOf(provenance.phases?.measure || '180s');

// --- runs -------------------------------------------------------------------
const runs = readFileSync(join(EXP, 'runs.tsv'), 'utf8')
  .split(/\r?\n/)
  .slice(1)
  .filter(Boolean)
  .map((line) => {
    const [name, exit, wallMs, startedAt, script, args] = line.split('\t');
    return { name, exit, wallMs: Number(wallMs), startedAt, script, args: args || '' };
  })
  .filter((r) => r.name);

/** group key + human label + the varying dimension, from the run name */
function describe(name) {
  let m;
  if ((m = name.match(/^sweep__vus(\d+)__r(\d+)$/))) {
    return { key: `sweep@${m[1]}`, suite: 'sweep', level: Number(m[1]), rep: Number(m[2]), label: `sweep, ${m[1]} VUs` };
  }
  if ((m = name.match(/^baseline__([a-z]+)__r(\d+)$/))) {
    return { key: `baseline:${m[1]}`, suite: 'baseline', arm: m[1], rep: Number(m[2]), label: `baseline arm "${m[1]}"` };
  }
  if ((m = name.match(/^staking__([A-D])__r(\d+)$/))) {
    return { key: `staking:${m[1]}`, suite: 'staking', scenario: m[1], rep: Number(m[2]), label: `staking scenario ${m[1]}` };
  }
  if ((m = name.match(/^(stress|spike|endurance)__r(\d+)$/))) {
    return { key: m[1], suite: m[1], rep: Number(m[2]), label: m[1] };
  }
  return { key: name, suite: 'other', label: name };
}

// --- metric extraction ------------------------------------------------------
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function mv(metrics, key, stat) {
  const m = metrics[key];
  if (!m) return null;
  return num(m[stat]);
}

/** k6 summary export writes a Rate as {value}, older/other writers as {rate} */
function rateOf(metrics, key) {
  const m = metrics[key];
  if (!m) return null;
  return num(m.value) ?? num(m.rate);
}

/**
 * Latency of the measurement window, falling back to the whole-run figure for
 * the shapes/arms that have no phases (baseline, staking, stress, spike,
 * endurance), where the entire run IS the measurement.
 */
function lat(metrics, stat) {
  return mv(metrics, 'http_req_duration{phase:measure}', stat) ?? mv(metrics, 'http_req_duration', stat);
}

/** error rate as a fraction: measurement window when present, else whole run */
function errorRate(metrics) {
  return rateOf(metrics, 'http_req_failed{phase:measure}') ?? rateOf(metrics, 'http_req_failed');
}

/** measurement-window request count per second */
function measureThroughput(metrics) {
  const c = mv(metrics, 'http_reqs{phase:measure}', 'count');
  if (c === null || MEASURE_S <= 0) return null;
  return c / MEASURE_S;
}

/**
 * Throughput for the fixed-size arms (baseline, staking), which have no phases:
 * total requests over the run's own wall-clock duration, taken from runs.tsv.
 * Supplied by the caller through the `wallMs` field.
 */
function armThroughput(metrics, wallMs) {
  const total = mv(metrics, 'http_reqs', 'count');
  if (total === null || !wallMs || wallMs <= 0) return null;
  return total / (wallMs / 1000);
}

const MEASUREMENT_SCOPED = [
  'lat_avg_ms', 'lat_p50_ms', 'lat_p90_ms', 'lat_p95_ms', 'lat_p99_ms',
  'lat_min_ms', 'lat_max_ms', 'throughput_rps', 'success_rps', 'requests_measure',
  'error_rate_pct', 'success_rate_pct', 'failed_requests_measure',
];
const SHAPES = new Set(['stress', 'spike', 'endurance']);

const EXTRACT = {
  // --- §6 latency, measurement window only ---------------------------------
  lat_avg_ms: (m) => lat(m, 'avg'),
  lat_p50_ms: (m) => lat(m, 'med'),
  lat_p90_ms: (m) => lat(m, 'p(90)'),
  lat_p95_ms: (m) => lat(m, 'p(95)'),
  lat_p99_ms: (m) => lat(m, 'p(99)'),
  lat_min_ms: (m) => lat(m, 'min'),
  lat_max_ms: (m) => lat(m, 'max'),
  // whole-run latency (all phases), for the spike/stress shapes
  run_lat_avg_ms: (m) => mv(m, 'http_req_duration', 'avg'),
  run_lat_p95_ms: (m) => mv(m, 'http_req_duration', 'p(95)'),
  run_lat_p99_ms: (m) => mv(m, 'http_req_duration', 'p(99)'),
  run_lat_max_ms: (m) => mv(m, 'http_req_duration', 'max'),

  // --- §6 throughput / success / errors -----------------------------------
  throughput_rps: measureThroughput,
  // Successful request throughput. Raw throughput alone rewards a node that
  // fails fast: a rejected request is still a request. Capacity claims use this
  // figure so a saturation cliff cannot masquerade as a throughput peak.
  success_rps: (m) => {
    const tp = measureThroughput(m);
    const e = errorRate(m);
    return tp === null || e === null ? null : tp * (1 - e);
  },
  throughput_rps_run: (m) => mv(m, 'http_reqs', 'rate'),
  requests_total: (m) => mv(m, 'http_reqs', 'count'),
  requests_measure: (m) => mv(m, 'http_reqs{phase:measure}', 'count'),
  error_rate_pct: (m) => scale(errorRate(m), 100),
  error_rate_run_pct: (m) => scale(rateOf(m, 'http_req_failed'), 100),
  success_rate_pct: (m) => complement(scale(errorRate(m), 100)),
  rpc_ok_pct: (m) => scale(rateOf(m, 'rpc_ok'), 100),
  failed_requests_measure: (m) => failedCount(m),

  // --- §7 blockchain: send/inclusion outcomes -----------------------------
  send_ok_total: (m) => mv(m, 'send_ok', 'count'),
  send_fail_total: (m) => mv(m, 'send_fail', 'count'),
  mined_ok_total: (m) => mv(m, 'mined_ok', 'count'),
  mined_revert_total: (m) => mv(m, 'mined_revert', 'count'),
  no_receipt_total: (m) => mv(m, 'no_receipt', 'count'),

  // --- §7 gas, per operation ----------------------------------------------
  // k6 exports a Trend with no samples as all-zero rather than omitting it. A
  // mined transaction cannot cost 0 gas, so a zero here means "never executed"
  // and must not be averaged in as a real measurement.
  gas_mint_avg: (m) => gasMetric(m, 'gas_used{op:mint}'),
  gas_buy_avg: (m) => gasMetric(m, 'gas_used{op:buy}'),
  gas_approve_avg: (m) => gasMetric(m, 'gas_used{op:approve}'),
  gas_retire_avg: (m) => gasMetric(m, 'gas_used{op:retire}'),
  gas_retire_p95: (m) => gasMetric(m, 'gas_used{op:retire}', 'p(95)'),
  retire_send_fail_total: (m) => mv(m, 'send_fail{op:retire}', 'count'),
  retire_mined_ok_total: (m) => mv(m, 'mined_ok{op:retire}', 'count'),
  gas_stake_avg: (m) => gasMetric(m, 'gas_used{op:stake}'),
  gas_challenge_avg: (m) => gasMetric(m, 'gas_used{op:challenge}'),
  gas_propose_avg: (m) => gasMetric(m, 'gas_used{op:propose}'),
  gas_msig_avg: (m) => gasMetric(m, 'gas_used{op:msig}'),

  // --- §7 confirmation time -----------------------------------------------
  confirm_ms_avg: (m) => mv(m, 'confirm_ms{op:buy}', 'avg'),
  confirm_ms_p95: (m) => mv(m, 'confirm_ms{op:buy}', 'p(95)'),

  // --- §8 staking / challenge ---------------------------------------------
  challenges_created: (m) => mv(m, 'challenges_created', 'count'),
  challenges_resolved: (m) => mv(m, 'challenges_resolved', 'count'),
  challenge_lifecycle_ms_avg: (m) => positive(m, 'challenge_lifecycle_ms'),
  stake_lifecycle_ms_avg: (m) => positive(m, 'stake_lifecycle_ms'),

  // --- baseline arms -------------------------------------------------------
  verifications: (m) => mv(m, 'verifications', 'count'),
  verify_latency_ms_avg: (m) => mv(m, 'verify_latency_ms', 'avg'),
  verify_latency_ms_p95: (m) => mv(m, 'verify_latency_ms', 'p(95)'),
};

function gasMetric(metrics, key, stat = 'avg') {
  const v = mv(metrics, key, stat);
  return v === null || v <= 0 ? null : v;
}

/** A duration that was never sampled is exported by k6 as 0, not as absent. */
function positive(metrics, key) {
  const v = mv(metrics, key, 'avg');
  return v === null || v <= 0 ? null : v;
}

function scale(v, f) {
  return v === null ? null : v * f;
}
function complement(v) {
  return v === null ? null : 100 - v;
}
function failedCount(m) {
  // k6 does not export a failed counter directly; total * rate reconstructs it.
  const total = mv(m, 'http_reqs{phase:measure}', 'count') ?? mv(m, 'http_reqs', 'count');
  const rate = errorRate(m);
  return total === null || rate === null ? null : total * rate;
}

// --- per-run rows -----------------------------------------------------------
const perRun = [];
for (const run of runs) {
  const sumPath = join(EXP, `${run.name}.summary.json`);
  const meta = describe(run.name);
  if (!existsSync(sumPath)) {
    perRun.push({ ...run, ...meta, missing: true });
    continue;
  }
  let metrics;
  try {
    metrics = JSON.parse(readFileSync(sumPath, 'utf8')).metrics || {};
  } catch {
    perRun.push({ ...run, ...meta, missing: true });
    continue;
  }
  const row = { ...run, ...meta, missing: false };
  for (const [id, fn] of Object.entries(EXTRACT)) {
    let v = null;
    try {
      v = fn(metrics);
    } catch {
      v = null;
    }
    row[id] = v;
  }
  // phase-tagged throughput does not exist in the fixed-size arms
  if (row.throughput_rps === null) row.throughput_rps = armThroughput(metrics, run.wallMs);
  row.throughput_rps_run = row.throughput_rps_run ?? row.throughput_rps;

  // A run can finish without ever producing traffic inside its measurement
  // window (at 1000 VUs the k6 scheduler is still draining the ramp when the
  // stage ends). Reporting the resulting zeros as "0 ms / 0 req/s / 100 %
  // success" would put a fabricated measurement into the statistics, so those
  // fields are dropped for that rep and its whole-run transaction outcomes are
  // kept. Which reps were dropped is recorded, not hidden.
  // Only the sweep tags warm-up/measure/cool-down phases. For the fixed-size
  // arms and the stress/spike/endurance shapes the whole run is the measurement,
  // so "no phase-tagged requests" is not a missing window there.
  const phased = row.suite === 'sweep';
  row.measure_valid = phased ? (row.requests_measure ?? 0) > 0 : true;
  if (!row.measure_valid) {
    for (const id of MEASUREMENT_SCOPED) row[id] = null;
  }

  // The stress/spike/endurance shapes tag the whole run as `measure`, because
  // a ramp is the treatment rather than noise to exclude. Their throughput is
  // therefore the run's own rate, not the count divided by the sweep's 180 s
  // measurement window (which would inflate a 30-minute endurance run ~10x).
  if (SHAPES.has(row.suite)) {
    row.throughput_rps = row.throughput_rps_run;
    row.success_rps = row.throughput_rps !== null && row.error_rate_pct !== null
      ? row.throughput_rps * (1 - row.error_rate_pct / 100)
      : null;
  }
  // resource summary
  const resPath = join(EXP, `${run.name}.resources.csv`);
  if (existsSync(resPath)) {
    const lines = readFileSync(resPath, 'utf8').split(/\r?\n/).filter((l) => l.trim());
    const header = lines[0].split(',');
    const rows = lines.slice(1).map((l) => l.split(','));
    // The sampler writes a blank row when the node has been shut down; parsing
    // that as 0 MB would make memory growth look like a 5 GB collapse.
    const col = (name) =>
      rows
        .map((r) => String(r[header.indexOf(name)] ?? '').trim())
        .filter((s) => s !== '')
        .map(Number)
        .filter(Number.isFinite);
    const nodePct = col('node_cpu_pct');
    const rss = col('node_rss_mb');
    const sysPct = col('sys_cpu_pct');
    row.mon_samples = rows.length;
    row.node_cpu_pct_avg = nodePct.length ? mean(nodePct) : null;
    row.node_cpu_pct_max = nodePct.length ? Math.max(...nodePct) : null;
    row.sys_cpu_pct_avg = sysPct.length ? mean(sysPct) : null;
    row.sys_cpu_pct_max = sysPct.length ? Math.max(...sysPct) : null;
    row.node_rss_mb_first = rss.length ? rss[0] : null;
    row.node_rss_mb_last = rss.length ? rss[rss.length - 1] : null;
    row.node_rss_mb_max = rss.length ? Math.max(...rss) : null;
    row.node_rss_growth_mb = rss.length > 1 ? rss[rss.length - 1] - rss[0] : null;
  }
  perRun.push(row);
}

// --- statistics -------------------------------------------------------------
function mean(a) {
  return a.reduce((x, y) => x + y, 0) / a.length;
}
function variance(a) {
  if (a.length < 2) return 0;
  const m = mean(a);
  return a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1); // sample variance
}
function stdev(a) {
  return Math.sqrt(variance(a));
}
/** linear-interpolation percentile (same convention as numpy's default) */
function percentile(a, p) {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  const idx = (p / 100) * (s.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return lo === hi ? s[lo] : s[lo] + (s[hi] - s[lo]) * (idx - lo);
}
function statsOf(values) {
  const v = values.filter((x) => x !== null && Number.isFinite(x));
  if (!v.length) return null;
  const sd = stdev(v);
  return {
    n: v.length,
    mean: mean(v),
    median: percentile(v, 50),
    stdev: sd,
    variance: variance(v),
    min: Math.min(...v),
    max: Math.max(...v),
    p90: percentile(v, 90),
    p95: percentile(v, 95),
    p99: percentile(v, 99),
    // 95% CI for the mean, normal approximation (t would need a table; with
    // n=3 this is the honest "where the mean plausibly sits", not a claim).
    ci95: v.length > 1 ? 1.96 * sd / Math.sqrt(v.length) : 0,
  };
}

const groups = new Map();
for (const row of perRun) {
  if (row.missing) continue;
  if (!groups.has(row.key)) groups.set(row.key, []);
  groups.get(row.key).push(row);
}

const aggregate = {};
for (const [key, rows] of groups) {
  const metricIds = [...Object.keys(EXTRACT), 'node_cpu_pct_avg', 'node_rss_mb_max', 'node_rss_growth_mb', 'sys_cpu_pct_avg'];
  const out = { label: rows[0].label, suite: rows[0].suite, reps: rows.length, metrics: {} };
  for (const id of metricIds) {
    const vals = rows.map((r) => (r[id] === undefined ? null : r[id]));
    const s = statsOf(vals);
    if (!s) continue;
    out.metrics[id] = { ...s, values: vals.map((x) => (x === null || !Number.isFinite(x) ? null : round(x))) };
  }
  out.failedRuns = rows.filter((r) => r.exit !== '0').map((r) => r.name);
  aggregate[key] = out;
}

function round(x) {
  return Math.round(x * 1000) / 1000;
}

// --- outputs ----------------------------------------------------------------
writeFileSync(join(EXP, 'aggregate.json'), JSON.stringify({ provenance, groups: aggregate }, null, 2) + '\n');

// flat CSV: group, metric, mean, stdev, median, min, max, p95, n, values
const csv = ['group,suite,metric,n,mean,stdev,variance,median,min,max,p90,p95,p99,ci95,values'];
for (const [key, g] of Object.entries(aggregate)) {
  for (const [id, s] of Object.entries(g.metrics)) {
    csv.push(
      [
        key,
        g.suite,
        id,
        s.n,
        num2(s.mean),
        num2(s.stdev),
        num2(s.variance),
        num2(s.median),
        num2(s.min),
        num2(s.max),
        num2(s.p90),
        num2(s.p95),
        num2(s.p99),
        num2(s.ci95),
        '"' + s.values.join(' ') + '"',
      ].join(',')
    );
  }
}
writeFileSync(join(EXP, 'aggregate.csv'), csv.join('\n') + '\n');

function num2(x) {
  return x === null || x === undefined ? '' : Math.round(x * 1000) / 1000;
}

// per-run CSV
const runIds = ['measure_valid', 'throughput_rps', 'success_rps', 'lat_avg_ms', 'lat_p50_ms', 'lat_p95_ms', 'lat_p99_ms', 'lat_max_ms', 'error_rate_pct', 'success_rate_pct', 'requests_total', 'mined_ok_total', 'mined_revert_total', 'send_fail_total', 'node_rss_growth_mb'];
const rcsv = ['run,group,rep,exit,wall_ms,' + runIds.join(',')];
for (const r of perRun) {
  rcsv.push([r.name, r.key, r.rep, r.exit, r.wallMs, ...runIds.map((id) => (id === 'measure_valid' ? (r[id] ? 1 : 0) : num2(r[id])))].join(','));
}
writeFileSync(join(EXP, 'runs.csv'), rcsv.join('\n') + '\n');

// --- console digest ---------------------------------------------------------
console.log(`aggregated ${perRun.length} runs into ${Object.keys(aggregate).length} groups`);
console.log(`wrote aggregate.json, aggregate.csv, runs.csv in ${EXP}\n`);
const sweepKeys = Object.keys(aggregate)
  .filter((k) => k.startsWith('sweep@'))
  .sort((a, b) => Number(a.split('@')[1]) - Number(b.split('@')[1]));
if (sweepKeys.length) {
  console.log('level   reps  p95 latency (ms)      throughput (req/s)     error %      success %');
  for (const k of sweepKeys) {
    const m = aggregate[k].metrics;
    const f = (s, d = 2) => (s ? s.mean.toFixed(d) : 'n/a');
    const sd = (s, d = 2) => (s ? s.stdev.toFixed(d) : 'n/a');
    console.log(
      `${k.padEnd(8)}${String(aggregate[k].reps).padEnd(6)}${f(m.lat_p95_ms).padStart(8)} ± ${sd(m.lat_p95_ms).padEnd(8)}` +
        `${f(m.throughput_rps).padStart(12)} ± ${sd(m.throughput_rps).padEnd(10)}` +
        `${f(m.error_rate_pct).padStart(8)}   ${f(m.success_rate_pct).padStart(8)}`
    );
  }
}
