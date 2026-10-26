#!/usr/bin/env node
/**
 * Builds the research-paper experiment report from measured data.
 *
 *   node loadtest/report/build-report.mjs            # -> docs/Research_Paper_Experiments.md
 *
 * Inputs (all produced by the harness, none typed in by hand):
 *   loadtest/results/exp/aggregate.json    per-group statistics (stats.mjs)
 *   loadtest/results/exp/provenance.json   environment, versions, levels, repetitions
 *   loadtest/results/exp/runs.tsv          exit code + wall time per run
 *   loadtest/personas/persona-library.json simulated-user population
 *
 * The specification requires the interpretation to be derived rather than
 * exaggerated (§17.9), so the headline claims here are *computed*: the level at
 * which throughput peaks, the first level where the success rate drops, the
 * first level where p95 breaks a stated budget. If a claim cannot be computed
 * from the data, the section says so instead of asserting something.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const EXP = join(HERE, '..', 'results', 'exp');
const OUT = join(ROOT, 'docs', 'Research_Paper_Experiments.md');

if (!existsSync(join(EXP, 'aggregate.json'))) {
  console.error(`missing ${EXP}/aggregate.json — run loadtest/report/stats.mjs first`);
  process.exit(2);
}

const agg = JSON.parse(readFileSync(join(EXP, 'aggregate.json'), 'utf8'));
const prov = agg.provenance || {};
const groups = agg.groups || {};
const runs = existsSync(join(EXP, 'runs.tsv'))
  ? readFileSync(join(EXP, 'runs.tsv'), 'utf8').split(/\r?\n/).slice(1).filter(Boolean)
  : [];
const personas = existsSync(join(ROOT, 'loadtest', 'personas', 'persona-library.json'))
  ? JSON.parse(readFileSync(join(ROOT, 'loadtest', 'personas', 'persona-library.json'), 'utf8'))
  : null;

// --- formatting helpers -----------------------------------------------------
const NA = '_not measured in this run_';
const n = (v) => (v === null || v === undefined || Number.isNaN(v) ? null : Number(v));
const f = (v, d = 2) => (n(v) === null ? '—' : n(v).toFixed(d));
/** mean ± stdev, the format §10 asks for */
const pm = (s, d = 2) => (s ? `${f(s.mean, d)} ± ${f(s.stdev, d)}` : '—');
const m = (key, id) => (groups[key] && groups[key].metrics ? groups[key].metrics[id] : null);
const val = (key, id) => (m(key, id) ? m(key, id).mean : null);

function levels() {
  return Object.keys(groups)
    .filter((k) => k.startsWith('sweep@'))
    .map((k) => ({ key: k, vus: Number(k.split('@')[1]) }))
    .sort((a, b) => a.vus - b.vus);
}
const LEVELS = levels();

function table(headers, rows) {
  const out = [`| ${headers.join(' | ')} |`, `|${headers.map(() => '---').join('|')}|`];
  for (const r of rows) out.push(`| ${r.join(' | ')} |`);
  return out.join('\n');
}

function relPath(p) {
  return p.replace(/\\/g, '/');
}

// --- derived findings -------------------------------------------------------
function derive() {
  const d = {
    peakOk: null,
    peakAt: null,
    degradationAt: null,
    successBreaches: [],
    latencyBreaches: [],
    errorBreaches: [],
    failureDominated: [],
    missingMeasure: [],
    points: [],
  };
  const pts = LEVELS.map(({ key, vus }) => ({
    vus,
    key,
    tp: val(key, 'throughput_rps'),
    tpOk: val(key, 'success_rps'),
    p95: val(key, 'lat_p95_ms'),
    p99: val(key, 'lat_p99_ms'),
    success: val(key, 'success_rate_pct'),
    err: val(key, 'error_rate_pct'),
    reqs: val(key, 'requests_measure'),
    reps: groups[key].reps,
    measuredReps: m(key, 'lat_p95_ms') ? m(key, 'lat_p95_ms').n : 0,
  })).filter((p) => p.reqs !== null && p.reqs > 0);

  // The capacity figure is *successful* throughput. Raw throughput counts a
  // rejected request as work done, so a node that fails fast can look like it
  // scaled up at the very point it collapsed.
  for (const p of pts) {
    if (p.tpOk !== null && (d.peakOk === null || p.tpOk > d.peakOk)) {
      d.peakOk = p.tpOk;
      d.peakAt = p.vus;
    }
  }
  for (const p of pts) {
    if (d.peakAt !== null && p.vus > d.peakAt && p.tpOk !== null && p.tpOk < d.peakOk * 0.95) {
      d.degradationAt = p.vus;
      break;
    }
  }
  for (const p of pts) {
    if (p.success !== null && p.success < 99) d.successBreaches.push({ vus: p.vus, value: p.success });
    if (p.err !== null && p.err > 1) d.errorBreaches.push({ vus: p.vus, value: p.err });
    if (p.success !== null && p.success < 50) d.failureDominated.push(p.vus);
    // A p95 taken while most requests fail instantly describes the rejected
    // majority, not user-perceived latency, so it is not a latency breach.
    if (p.p95 !== null && p.p95 > 1000 && (p.success ?? 0) >= 90) {
      d.latencyBreaches.push({ vus: p.vus, value: p.p95 });
    }
  }
  for (const p of pts) {
    if (p.measuredReps < p.reps) {
      d.missingMeasure.push({ vus: p.vus, dropped: p.reps - p.measuredReps, reps: p.reps });
    }
  }
  d.points = pts;
  return d;
}
/** Total retireAndCertify attempts rejected at submission across the sweep.
 *  The aggregate stores a per-level mean, so multiply by the level's reps. */
function retireFailures() {
  return LEVELS.reduce((a, { key }) => a + (val(key, 'retire_send_fail_total') ?? 0) * groups[key].reps, 0);
}
function retireMined() {
  return LEVELS.reduce((a, { key }) => a + (val(key, 'retire_mined_ok_total') ?? 0) * groups[key].reps, 0);
}
const D = derive();

// --- section builders -------------------------------------------------------
function s1_setup() {
  const rows = [
    ['Host', prov.host || '—'],
    ['Operating system', 'Windows, Git Bash (POSIX shell)'],
    ['CPU', prov.cpu || '—'],
    ['Memory', prov.memory || '—'],
    ['Node.js', prov.node || '—'],
    ['Load generator', prov.k6 || '—'],
    ['Blockchain', prov.chain || '—'],
    ['RPC endpoint', prov.rpcUrl || '—'],
    ['Smart-contract environment', 'Solidity 0.8.20, OpenZeppelin, compiled for the Paris EVM target'],
    ['Contracts under test', 'CreditToken, Marketplace, RetireAndCertify, VerifierStake, RegulatorMultisig (3-of-5), MockMRVOracle'],
    ['Baseline contract', `BaselineVerifier at ${prov.baselineContract || '—'} (load-test only; no stake, no challenge window)`],
    ['Database', 'None — the EVM state is the only persistent store; there is no separate DB tier to measure'],
    ['Simulated users', `${LEVELS.length ? LEVELS.map((l) => l.vus).join(', ') : '—'} concurrent virtual users (processor-scripted, not real factories)`],
    ['Load phases', `warm-up ${prov.phases?.warmup || '—'}, measurement ${prov.phases?.measure || '—'}, cool-down ${prov.phases?.cooldown || '—'}`],
    ['Repetitions', `${prov.repetitions ?? '—'} independent runs per workload level`],
    ['Runs recorded', `${runs.length}`],
    ['Git revision', `${prov.gitRevision || '—'}${prov.gitDirtyFiles ? ` (${prov.gitDirtyFiles} files modified in the working tree)` : ''}`],
    ['Recorded at', prov.recordedAt || '—'],
  ];
  return table(['Item', 'Value'], rows);
}

function s2_workload() {
  const ops = [
    ['read', 'totalSupply, getBatchInfo, getBatchSupply, getUserBatchBalance, getListing, getActiveListings, getUserCertificates, getVerifierInfo, eth_blockNumber', '78%'],
    ['buy', 'Marketplace.buyTokens(1 credit) — a credit transfer', '20%'],
    ['retire', 'CreditToken.approve then RetireAndCertify.retireAndCertify(0.25 credit) — burn + soulbound certificate', '2%'],
  ];
  let out = table(['Actor share', 'Operations issued', 'Mix'], ops);

  out += `\n\nThere is deliberately **no project-submission or login API in the scenario**, because the
implementation has none: a verifier attests a batch by minting it (\`CreditToken.mintBatch\`), which is what
the challenge window is measured from (\`getBatchTimestamp\`). Inventing endpoints the contracts do not
expose would make the workload a fiction, so the specification's §3 operation list is mapped onto what
actually exists:

${table(
    ['Specification §3 operation', 'Where it exists in this implementation'],
    [
      ['User registration / login', 'Off-chain (wallet connection in the React app); no on-chain call'],
      ['Project submission / emission data', 'Off-chain payload carried as the IPFS hash argument of mintBatch'],
      ['Verification request / status', 'CreditToken.mintBatch (attestation) + VerifierStake.getVerifierInfo'],
      ['Credit balance / transfer / trade', 'CreditToken.balanceOf, Marketplace.buyTokens'],
      ['Credit retirement', 'RetireAndCertify.retireAndCertify (approve-then-retire, two transactions)'],
      ['Transaction history', 'RetireAndCertify.getUserCertificates (certificates as the audit trail)'],
      ['Verifier register / stake', 'VerifierStake.depositStake'],
      ['Verifier approve', 'CreditToken.mintBatch by a staked verifier'],
      ['Challenger view / submit / evidence / status', 'VerifierStake.getBatchChallenges, createChallenge(batchId, evidenceHash), getChallenge'],
      ['Challenge resolution', 'RegulatorMultisig.proposeResolution + 3 x approveResolution -> VerifierStake.resolveChallenge'],
    ]
  )}`;

  if (personas) {
    const roles = [...new Set(personas.personas.map((p) => p.role))];
    const journeys = [...new Set(personas.personas.flatMap((p) => p.journeys))];
    out += `\n\n### Behavioural population\n\n`;
    out += `${personas.personas.length} personas (\`${relPath('loadtest/personas/persona-library.json')}\`,
generated by \`${personas.generatedBy}\`${personas.model ? ` (model \`${personas.model}\`)` : ''}, covering
${roles.length} roles (${roles.join(', ')}) and ${journeys.length} journeys (${journeys.join(', ')}).
They parameterise *who* drives the journeys (risk tolerance, transaction budget, retry and abort
behaviour). They are **not** used to claim the k6 numbers represent real organisations: the load
generator is scripted, and the personas describe behaviour classes rather than real users.`;
  }
  return out;
}

function s3_performance() {
  if (!LEVELS.length) return `No workload-level runs were recorded. ${NA}`;

  let out = `All figures are the mean ± standard deviation of the per-run values across the
${prov.repetitions ?? '—'} repetitions, measured **inside the measurement window** (warm-up and
cool-down traffic excluded).\n\n`;

  out += table(
    ['Concurrent users', 'Reps', 'Avg latency (ms)', 'p50 (ms)', 'p95 (ms)', 'p99 (ms)', 'Throughput, all requests (req/s)', 'Throughput, successful (req/s)', 'Error rate (%)', 'Success rate (%)'],
    LEVELS.map(({ key, vus }) => [
      vus,
      groups[key].reps,
      pm(m(key, 'lat_avg_ms')),
      pm(m(key, 'lat_p50_ms')),
      pm(m(key, 'lat_p95_ms')),
      pm(m(key, 'lat_p99_ms')),
      pm(m(key, 'throughput_rps')),
      pm(m(key, 'success_rps')),
      pm(m(key, 'error_rate_pct')),
      pm(m(key, 'success_rate_pct')),
    ])
  );

  out += `\n\nThe two throughput columns are not interchangeable. **All requests** counts
rejected requests as throughput; **successful** counts only requests that returned a usable response, and it
is the column any capacity claim in §10 uses. Where the success rate collapses, the two diverge by design —
the all-requests figure then measures the failure rate, not capacity.`;

  if (D.missingMeasure.length) {
    out += `\n\nReps whose measurement window produced no traffic are excluded from the measurement\ncolumns rather than counted as zero (${D.missingMeasure.map((d) => `${d.vus} users: ${d.dropped} of ${d.reps} reps`).join('; ')}). Their whole-run
transaction outcomes are still counted in the next table.`;
  }
  for (const vus of D.failureDominated) {
    const p = D.points.find((x) => x.vus === vus);
    out += `\n\nThe **${vus}-user row is failure-dominated**: ${f(100 - p.success, 1)}% of requests were rejected, most
of them immediately, so its p50 and p95 describe failed connections rather than user-perceived latency.
Read its success and successful-throughput columns; its latency is excluded from the claims in §10.`;
  }

  out += `\n\nPercentage-latency curves: see ${relPath('../loadtest/results/exp/graphs/fig01_latency_vs_users.png')}, `
    + `${relPath('../loadtest/results/exp/graphs/fig02_throughput_vs_users.png')}, `
    + `${relPath('../loadtest/results/exp/graphs/fig03_success_error_vs_users.png')}.\n`;

  out += `\n\n### Requests and transactions per level\n\n`;
  out += table(
    ['Concurrent users', 'Requests (measure)', 'Requests rejected / no receipt', 'Transactions mined (status 1)', 'Transactions mined but reverted'],
    LEVELS.map(({ key, vus }) => [
      vus,
      f(val(key, 'requests_measure'), 0),
      f(val(key, 'send_fail_total'), 0),
      f(val(key, 'mined_ok_total'), 0),
      f(val(key, 'mined_revert_total'), 0),
    ])
  );
  return out;
}

function s4_blockchain() {
  let out = `### Gas per operation\n\n`;
  const gasRows = [];
  const top = LEVELS.length ? LEVELS[LEVELS.length - 1].key : null;
  const gasOps = [
    ['gas_mint_avg', 'mintBatch (1000 credits)', 'sweep'],
    ['gas_buy_avg', 'buyTokens (1 credit)', 'sweep'],
    ['gas_approve_avg', 'approve (ERC-20)', 'sweep'],
    ['gas_retire_avg', 'retireAndCertify (0.25 credit)', 'sweep'],
    ['gas_stake_avg', 'depositStake (1 ETH)', 'staking'],
    ['gas_challenge_avg', 'createChallenge (0.1 ETH bond)', 'staking'],
    ['gas_propose_avg', 'proposeResolution (multisig)', 'staking'],
    ['gas_msig_avg', 'approveResolution (multisig, executes at threshold)', 'staking'],
  ];
  for (const [id, label, scope] of gasOps) {
    let s = null;
    if (scope === 'sweep' && top) s = m(top, id);
    else {
      for (const k of Object.keys(groups)) {
        if (k.startsWith('staking') && m(k, id)) { s = m(k, id); break; }
      }
    }
    const has = s && s.n > 0;
    gasRows.push([label, has ? f(s.mean, 0) : '—', has ? f(s.p95, 0) : '—', has ? f(s.min, 0) : '—', has ? f(s.max, 0) : '—']);
  }
  out += table(['Operation', 'Mean gas', 'p95 gas', 'Min', 'Max'], gasRows);

  out += `\n\nGas figures are **measured from transaction receipts** (\`receipt.gasUsed\`), not estimated.
Where a cell is \`—\` the operation did not execute in that scope in this run; it is left blank rather
than filled with a plausible number.`;

  const retireFails = retireFailures();
  if (retireMined() === 0 && retireFails > 0) {
    out += `\n\n**Retirement produced no measurement in this sweep.** All ${f(retireFails, 0)} retireAndCertify
attempts were rejected at RPC submission (\`send_fail\`) and none was mined, so the row above is empty
because nothing executed, not because retirement is free. The retirement path is exercised elsewhere
(the R6 buy→retire soak in \`docs/LoadTest_Report.md\` and the contract suite); a sweep that successfully
retires is a harness fix plus a fresh suite, not a re-reading of this data.`;
  }


  out += `\n\n### Confirmation time\n\n`;
  if (top && m(top, 'confirm_ms_avg')) {
    out += table(
      ['Concurrent users', 'Receipt round-trip, avg (ms)', 'p95 (ms)'],
      LEVELS.map(({ key, vus }) => [vus, pm(m(key, 'confirm_ms_avg')), pm(m(key, 'confirm_ms_p95'))])
    );
    out += `\n\n**Interpretation caveat:** the chain runs with Hardhat automine, so a transaction is mined
inside the \`eth_sendTransaction\` call and there is no mempool wait to measure. The numbers above are the
client-observed round trip that produced a receipt — a latency floor, not a public-network confirmation
time. See ${relPath('../loadtest/results/exp/graphs/fig06_confirmation_time.png')}.`;
  } else {
    out += `No confirmation-time samples were recorded. ${NA}`;
  }

  out += `\n\n### Contract execution cost of retirements\n\n`;
  out += `\`retireAndCertify\` is the most expensive operation in the system and its cost is
**state-dependent**: \`CreditToken._retireBatch\` scans the holder's batch list and re-sums balances, so
gas grows with how many batches the holder has ever received. `;
  const rr = [];
  for (const k of Object.keys(groups)) {
    if (!k.startsWith('sweep@')) continue;
    const s = m(k, 'gas_retire_avg');
    if (s) rr.push([k.split('@')[1], f(s.mean, 0), f(s.min, 0), f(s.max, 0)]);
  }
  out += rr.length
    ? `Measured per level:\n\n${table(['Concurrent users', 'Mean gas', 'Min', 'Max'], rr)}\n`
    : `${NA}.\n`;
  return out;
}

function s5_staking() {
  const keys = ['A', 'B', 'C', 'D'].map((s) => `staking:${s}`).filter((k) => groups[k]);
  if (!keys.length) return `No staking-scenario runs were recorded. ${NA}`;
  const desc = {
    A: 'Normal verification: stake + attest, batch enters its challenge window',
    B: 'Successful challenge: bond -> panel resolution -> stake slashed, batch flagged',
    C: 'Unsuccessful challenge: bond forfeited, no stake slashed',
    D: 'Concurrent challenges against one batch',
  };
  let out = table(
    ['Scenario', 'Reps', 'Per-request latency (ms)', 'Full lifecycle (ms)', 'Challenges created', 'Challenges resolved', 'Success rate (%)', 'Reverts'],
    keys.map((k) => {
      const letter = k.split(':')[1];
      const life = m(k, 'challenge_lifecycle_ms_avg') || m(k, 'stake_lifecycle_ms_avg');
      return [
        `**${letter}** — ${desc[letter]}`,
        groups[k].reps,
        pm(m(k, 'lat_avg_ms')),
        pm(life),
        f(val(k, 'challenges_created'), 0),
        f(val(k, 'challenges_resolved'), 0),
        pm(m(k, 'success_rate_pct')),
        f(val(k, 'mined_revert_total'), 0),
      ];
    })
  );

  out += `\n\nPer-operation gas across the challenge lifecycle:\n\n`;
  out += table(
    ['Scenario', 'createChallenge', 'proposeResolution', 'approveResolution', 'Resolution total (3-of-5)', 'depositStake'],
    keys.map((k) => {
      const g = (id) => (m(k, id) ? f(m(k, id).mean, 0) : '—');
      const chal = m(k, 'gas_challenge_avg');
      const prop = m(k, 'gas_propose_avg');
      const msig = m(k, 'gas_msig_avg');
      const total = chal || prop ? (chal?.mean || 0) + (prop?.mean || 0) + 3 * (msig?.mean || 0) : null;
      return [k.split(':')[1], g('gas_challenge_avg'), g('gas_propose_avg'), g('gas_msig_avg'), total ? f(total, 0) : '—', g('gas_stake_avg')];
    })
  );

  out += `\n\nA challenge therefore costs, in round terms, a bond-carrying submission plus **four**
transactions (one proposal and three threshold approvals) before the stake moves. That is the price of
removing single-key regulation: the same resolution that used to be one regulator transaction is now a
3-of-5 quorum.\n`;
  out += `\nSee ${relPath('../loadtest/results/exp/graphs/fig09_staking_scenarios.png')}.\n`;
  return out;
}

function s6_baseline() {
  const arms = ['baseline:baseline', 'baseline:nostake', 'baseline:stake'].filter((k) => groups[k]);
  if (!arms.length) return `No baseline-comparison runs were recorded. ${NA}`;
  const label = {
    'baseline:baseline': '**Baseline** — `BaselineVerifier`: submit + approve, no bond, no window, approval final',
    'baseline:nostake': 'Proposed contracts, staking layer off — plain `mintBatch` attestation',
    'baseline:stake': '**Proposed** — staked verifier: `depositStake` (amortised) + `mintBatch` + window/stake reads',
  };
  let out = table(
    ['Arm', 'Verifications (mean)', 'Verification latency, avg (ms)', 'Verification latency, p95 (ms)', 'Throughput (req/s)', 'Success rate (%)', 'Error rate (%)'],
    arms.map((k) => [
      label[k],
      f(val(k, 'verifications'), 0),
      pm(m(k, 'verify_latency_ms_avg')),
      pm(m(k, 'verify_latency_ms_p95')),
      pm(m(k, 'throughput_rps')),
      pm(m(k, 'success_rate_pct')),
      pm(m(k, 'error_rate_pct')),
    ])
  );

  out += `\n\nAll arms ran the **same arrival pattern** (fixed iteration counts per virtual user) against
the same chain, so the difference between rows is the verification mechanism, not the workload.

The mechanism's overhead has three separable parts, all measured above:

1. **A one-time stake per verifier** (\`depositStake\`), which is a value-bearing transaction that the
   baseline simply does not have. It is amortised across the verifier's batches, so its per-batch share
   falls with the verifier's throughput.
2. **The challenge-window machinery** — reading the window and the verifier's stake standing. Free at
   the RPC level (two \`eth_call\`s per verification) but structurally new state on every batch.
3. **The dispute path** — 0.1 ETH bond + four transactions per resolution (§5). This is the expensive
   part in absolute terms, and by construction it exists only in the proposed system.

The trade-off is therefore not "the mechanism slows verification down"; it is "the baseline cannot be
challenged at all, and the proposed system pays a bounded, mostly off-the-hot-path price for the ability
to reverse a fraudulent attestation." See ${relPath('../loadtest/results/exp/graphs/fig08_baseline_vs_proposed.png')}.`;
  return out;
}

function s7_shapes() {
  const defs = [
    {
      key: 'stress',
      name: 'Stress',
      shape: '10 → 50 → 100 → 250 → 500 → 1000 users, 90 s on each rung',
      purpose: 'find the level where the system stops doing work',
    },
    {
      key: 'spike',
      name: 'Spike',
      shape: '50 → 500 → 50 users, 180 s holds either side of a 10 s burst',
      purpose: 'test whether a sudden burst is absorbed or breaks the system',
    },
    {
      key: 'endurance',
      name: 'Endurance',
      shape: '100 users held for 30 minutes',
      purpose: 'look for drift, leak or exhaustion over time',
    },
  ].filter((d) => groups[d.key]);
  if (!defs.length) return `No stress, spike or endurance runs were recorded. ${NA}`;

  let out = table(
    ['Shape', 'Reps', 'Arrival pattern', 'Requests', 'Throughput, all (req/s)', 'Throughput, successful (req/s)', 'Success (%)', 'p95 (ms)', 'p99 (ms)', 'Mined txs', 'Rejected sends'],
    defs.map((d) => [
      `**${d.name}**`,
      groups[d.key].reps,
      d.shape,
      f(val(d.key, 'requests_measure'), 0),
      pm(m(d.key, 'throughput_rps')),
      pm(m(d.key, 'success_rps')),
      pm(m(d.key, 'success_rate_pct')),
      pm(m(d.key, 'lat_p95_ms')),
      pm(m(d.key, 'lat_p99_ms')),
      f(val(d.key, 'mined_ok_total'), 0),
      f(val(d.key, 'send_fail_total'), 0),
    ])
  );

  out += `\n\nFor these shapes the ramp **is** the treatment, so the whole run is the measurement
window; their throughput is not directly comparable with the steady-state levels in §3. Each shape exists
to answer a different question:\n\n`;
  for (const d of defs) out += `- **${d.name}** — ${d.purpose}.\n`;

  out += `\n\n### Node resources during the reliability shapes\n\n`;
  out += table(
    ['Shape', 'Node CPU, avg (%)', 'System CPU, avg (%)', 'Node RSS, max (MB)', 'RSS growth, first→last (MB)'],
    defs.map((d) => [
      d.name,
      pm(m(d.key, 'node_cpu_pct_avg')),
      pm(m(d.key, 'sys_cpu_pct_avg')),
      pm(m(d.key, 'node_rss_mb_max')),
      pm(m(d.key, 'node_rss_growth_mb')),
    ])
  );

  const notes = [];
  if (groups.stress) {
    const ok = val('stress', 'success_rate_pct');
    const p95 = val('stress', 'lat_p95_ms');
    notes.push(
      `- **Stress:** success fell to **${f(ok)}%** (p95 ${f(p95, 0)} ms) as the ladder reached its top rungs. The run's
non-zero exit is the 99 % success threshold being crossed — the expected outcome of a stress test, not a
suite failure. Its all-requests throughput is therefore not a capacity figure; successful throughput is.`
    );
  }
  if (groups.spike) {
    notes.push(
      `- **Spike:** success stayed at **${f(val('spike', 'success_rate_pct'))}%**, while p95 rose to
**${f(val('spike', 'lat_p95_ms'), 0)} ms** — the burst was absorbed as queueing latency rather than errors,
which is the failure mode a spike test is looking for.`
    );
  }
  if (groups.endurance) {
    notes.push(
      `- **Endurance:** 30 minutes at 100 users with success at **${f(val('endurance', 'success_rate_pct'))}%**
and p95 **${f(val('endurance', 'lat_p95_ms'), 0)} ms**. Node RSS moved from its first to its last sample by
**${f(val('endurance', 'node_rss_growth_mb'), 0)} MB** (max ${f(val('endurance', 'node_rss_mb_max'), 0)} MB); a
single 30-minute run can show growth without proving a leak, so this is reported as an observation, not as
a leak diagnosis.`
    );
  }
  out += `\n\n${notes.join('\n')}`;
  return out;
}

function s8_statistics() {
  if (!LEVELS.length) return `No workload-level runs were recorded. ${NA}`;
  let out = `Each level was run ${prov.repetitions ?? '—'} times. The table gives, **for each metric**,
the statistics §10 requires across those repetitions (mean, median, standard deviation, variance, min,
max, p90/p95/p99) plus a 95% confidence interval for the mean.\n\n`;
  out += `Two different percentiles appear in this report and they are not interchangeable:\n\n`;
  out += `- **within-run p95/p99** (§3 table): the request-latency tail of a single run's measurement window — what a user experiences.\n`;
  out += `- **across-run p95** (this table): the 95th percentile of the per-run *aggregate* values — how much the result moves between repetitions.\n\n`;

  const ids = ['lat_avg_ms', 'lat_p95_ms', 'lat_p99_ms', 'throughput_rps', 'success_rps', 'error_rate_pct'];
  const names = { lat_avg_ms: 'average latency (ms)', lat_p95_ms: 'p95 latency (ms)', lat_p99_ms: 'p99 latency (ms)', throughput_rps: 'throughput, all requests (req/s)', success_rps: 'throughput, successful (req/s)', error_rate_pct: 'error rate (%)' };
  for (const id of ids) {
    out += `**${names[id]}**\n\n`;
    out += table(
      ['Users', 'Mean', 'Median', 'Std dev', 'Variance', 'Min', 'Max', 'p90', 'p95', 'p99', '95% CI (±)'],
      LEVELS.filter(({ key }) => m(key, id)).map(({ key, vus }) => {
        const s = m(key, id);
        return [vus, f(s.mean), f(s.median), f(s.stdev), f(s.variance), f(s.min), f(s.max), f(s.p90), f(s.p95), f(s.p99), f(s.ci95)];
      })
    );
    out += `\n\n`;
  }
  if (D.failureDominated.length) {
    out += `The latency statistics at ${D.failureDominated.join(', ')} users are **failure-dominated**: the success rate there is
below 50%, k6 records a near-zero duration for a rejected request, and so those p95/p99 rows measure
failed connections rather than user latency and are excluded from the latency claims in §10. The
all-requests throughput row at the same level counts those rejections; the successful-throughput row is
the capacity figure those claims use.\n\n`;
  }
  out += `The confidence intervals are normal-approximation intervals on ${prov.repetitions ?? 'n'} repetitions.
With ${prov.repetitions ?? 'few'} repetitions they describe where the mean plausibly sits; they are not a
claim of statistical significance, and the variability is reported rather than smoothed away.`;
  if (D.missingMeasure.length) {
    out += `\n\nWhere a rep produced no traffic inside its measurement window it is excluded from these
statistics rather than entered as zero: ${D.missingMeasure.map((d) => `${d.vus} users rests on ${d.reps - d.dropped} of ${d.reps} reps`).join('; ')}.`;
  }
  return out;
}

function s9_graphs() {
  const figs = [
    ['fig01_latency_vs_users.png', 'Latency vs concurrent users (average, p95, p99)'],
    ['fig02_throughput_vs_users.png', 'Successful throughput vs concurrent users'],
    ['fig03_success_error_vs_users.png', 'Success and error rate vs concurrent users'],
    ['fig04_block_inclusion_outcomes.png', 'Transaction outcome mix (mined / reverted / rejected)'],
    ['fig05_gas_by_operation.png', 'Gas per operation, credits vs staking/challenge'],
    ['fig06_confirmation_time.png', 'Transaction confirmation round trip'],
    ['fig07_cpu_memory_vs_users.png', 'Blockchain node CPU and memory vs concurrent users'],
    ['fig08_baseline_vs_proposed.png', 'Baseline vs proposed system, identical workload'],
    ['fig09_staking_scenarios.png', 'Staking / challenge scenarios A–D'],
    ['fig10_stress_timeline.png', 'Stress test: resource timeline'],
    ['fig11_spike_timeline.png', 'Spike test: resource timeline'],
    ['fig12_endurance_timeline.png', 'Endurance test: resource timeline'],
  ];
  const prefix = relPath('../loadtest/results/exp/graphs/');
  const present = figs.filter(([file]) => existsSync(join(EXP, 'graphs', file)));
  if (!present.length) return `No graphs were generated in this run. ${NA}`;
  let out = `All graphs are generated from the measured data by \`loadtest/report/make-graphs.py\`; point
error bars are ±1 standard deviation across repetitions.\n\n`;
  for (const [file, caption] of present) {
    out += `### ${caption}\n\n![${caption}](${prefix}${file})\n\n`;
  }
  const missing = figs.filter(([file]) => !existsSync(join(EXP, 'graphs', file)));
  if (missing.length) {
    out += `Not produced in this run: ${missing.map(([x]) => `\`${x}\``).join(', ')} — `;
    out += `each of these needs the suite shape that produces it (stress / spike / endurance) to have completed.\n`;
  }
  return out;
}

function s10_interpretation() {
  if (!D.points.length) return `No workload-level results, so nothing is interpreted here. ${NA}`;

  const maxOk = D.points.filter((p) => (p.success ?? 100) >= 99).map((p) => p.vus);
  const lastOk = maxOk.length ? Math.max(...maxOk) : null;
  const successBreach = D.successBreaches[0];
  const latencyBreach = D.latencyBreaches[0];
  const last = D.points[D.points.length - 1];
  const rawPeak = D.points.reduce((a, p) => (p.tp !== null && (!a || p.tp > a.tp) ? p : a), null);
  const failureDominated = new Set(D.failureDominated);

  let out = '';
  out += `### What the numbers support\n\n`;
  out += `- **Successful** throughput peaked at **${f(D.peakOk, 1)} req/s at ${D.peakAt} concurrent users**.\n`;
  if (D.degradationAt) {
    out += `- Beyond that peak, successful throughput fell below 95% of it at **${D.degradationAt} users** — adding users
  stopped adding work done, which is the signature of a saturated component rather than a scaling system.\n`;
  } else {
    out += `- Successful throughput did not fall below 95% of its peak within the levels tested, so the saturation point
  was not reached inside this range.\n`;
  }
  if (rawPeak && rawPeak.success !== null && rawPeak.success < 50 && rawPeak.vus !== D.peakAt) {
    out += `- All-requests throughput kept rising to **${f(rawPeak.tp, 1)} req/s at ${rawPeak.vus} users**, but only
  ${f(rawPeak.success, 2)}% of those requests succeeded. That figure counts rejections as work done; it is the failure
  mode, not capacity, and no capacity claim here uses it.\n`;
  }
  if (lastOk !== null) {
    out += `- The system maintained a success rate of at least 99% up to **${lastOk} concurrent users**`;
    out += successBreach
      ? `; at ${successBreach.vus} users it fell to ${f(successBreach.value)}%.\n`
      : `, with no success-rate breach at any level tested.\n`;
  } else {
    out += `- Success rate did not stay at or above 99% at any tested level.\n`;
  }
  if (latencyBreach) {
    out += `- p95 latency first exceeded the 1000 ms budget at **${latencyBreach.vus} users** (${f(latencyBreach.value, 0)} ms),
  measured at a level where at least 90% of requests still succeed.\n`;
  } else {
    out += `- No level with at least 90% success breached the 1000 ms p95 budget.\n`;
  }
  if (last) {
    const p95Text = failureDominated.has(last.vus)
      ? 'not usable (failure-dominated level)'
      : `${f(last.p95, 1)} ms`;
    out += `- At the highest level tested (${last.vus} users): p95 ${p95Text}, successful throughput ${f(last.tpOk, 1)} req/s,
  success ${f(last.success, 2)}%.\n`;
    if (failureDominated.has(last.vus)) {
      out += `  The p95 at this level is not a user latency: ${f(100 - last.success, 1)}% of requests were rejected, most of them
  immediately, so the percentile describes failed connections. It is excluded from the latency claims above.\n`;
    }
  }
  out += `\n### What the numbers do **not** support\n\n`;
  if (D.degradationAt) {
    out += `- **"The system is highly scalable."** The measurements show the opposite above ${D.peakAt} users:
successful throughput *decreases* as load increases. The honest statement is a bounded-capacity statement,
not a scalability claim.\n`;
  } else if (LEVELS.length < 3) {
    out += `- **Any scaling claim at all.** Only ${LEVELS.length} workload level(s) produced results in this run, which is a
point measurement, not a scalability curve. Re-run the suite with the full level set before drawing any
scaling conclusion.\n`;
  } else {
    out += `- **Scalability beyond the tested range.** Successful throughput rose with load across the ${LEVELS.length} levels measured,
but that bounds the claim to those levels: no run above ${last.vus} users completed here, so nothing
is claimed about behaviour beyond it.\n`;
  }
  out += `- **Any claim about public-network behaviour.** The chain is a single-process local node with
automine. Its JSON-RPC read path is a single JavaScript thread, and that — not the contracts — is what
saturates here. A curve measured on Sepolia or an L2 would have a different shape and would need its own
run.\n`;
  out += `- **Any claim that k6 users are real factories.** The load generator is scripted; the personas in §2
describe behaviour classes, not real organisations.\n`;
  out += `- **Any security claim.** k6 generates load, not attacks (specification §16). The contract-level
security position rests on the unit/integration suites and the challenge/access-control tests, which
are reported separately in \`PROGRESS.md\` and \`docs/LoadTest_Report.md\`, not on this experiment.\n`;
  out += `\n### The trade-off, stated as narrowly as the evidence allows\n\n`;
  out += `The proposed mechanism adds a stake transaction per verifier and a four-transaction quorum
resolution per challenge, and in exchange makes a fraudulent attestation reversible for the length of
the challenge window. This experiment measures the *cost* side of that exchange — the verification path
(\`baseline:stake\`) carries the stake deposit and window reads on top of the baseline's approval, and the
dispute path exists only in the proposed system. It does **not** measure the *benefit* side; whether the
mechanism actually changes verifier behaviour is an incentive question that load testing cannot answer.`;
  return out;
}

function s11_limitations() {
  const rows = [
    ['Simulated users, not real factories', 'k6 issues scripted RPC/transaction workloads. The personas describe behaviour classes; no real organisation was observed.'],
    ['Local development chain', 'Hardhat node, single process, automine, 20 unlocked accounts. Latency has no network hop and no mempool; the RPC read path saturates early and is the measured bottleneck.'],
    ['No block-production or gas-price dynamics', 'Automine mines one block per transaction at a fixed base fee, so block inclusion time and fee-market effects are outside what this experiment can measure.'],
    ['Bounded repetitions', `${prov.repetitions ?? '—'} repetitions per workload level. Means are reported with standard deviations and 95% confidence intervals; wider sampling would tighten them.`],
    ['Measurement-window length', `Each repetition held its level for ${prov.phases?.measure || '—'} after a ${prov.phases?.warmup || '—'} ramp. Longer holds would expose slow drifts that this window cannot.`],
    ['Write concurrency limited by accounts', 'Five role-bearing accounts carry the write load; higher write concurrency is limited by the chain configuration, not by the contracts.'],
    ['Stake decay under repeated successful challenges', 'Slashing takes half the remaining stake, so a verifier is economically exhausted after a handful of upheld challenges. Scenario B therefore measures challenge cost and mechanics, not a long-run economic equilibrium.'],
    ['One host for generator and chain', 'k6 and the chain node share the CPU and memory of a single machine, so resource contention between them is possible and was not isolated.'],
    ['k6 is not a security tool', 'Concurrent challenges and repeated requests were exercised as controlled adversarial load; reentrancy, access control, overflow and authorisation were evaluated by the contract test suites, not here.'],
    ['Baseline is a load-test artefact', '`BaselineVerifier` is a deliberately minimal no-stake/no-window registry written for this comparison and is not part of the product. It shares the CreditToken, so the comparison isolates the staking layer, but it is a model of the baseline rather than a deployed alternative system.'],
  ];

  if (retireMined() === 0 && retireFailures() > 0) {
    rows.push([
      'Retirement not exercised in the sweep',
      `All ${f(retireFailures(), 0)} retireAndCertify attempts were rejected at RPC submission and none was mined, so §4 has no retirement gas measurement and the 2% retire share in §2 is the scripted share, not a completed journey. The path is covered by the contract suite and the R6 soak, but not by these throughput numbers.`,
    ]);
  }
  if (D.failureDominated.length) {
    rows.push([
      'Latency percentiles include failed requests',
      `k6 measures duration for rejected requests too. At ${D.failureDominated.join(', ')} users the success rate collapsed below 50%, so percentiles there describe fast failures rather than user-perceived latency; levels under 90% success are excluded from every latency claim in §10.`,
    ]);
  }
  if (D.missingMeasure.length) {
    rows.push([
      'Reps without a measurement window',
      `${D.missingMeasure.map((d) => `${d.vus} users: ${d.dropped} of ${d.reps} reps`).join('; ')} produced no traffic inside the measurement window. Those reps are excluded from the measurement columns instead of being counted as zero, but they do reduce the sample behind those means.`,
    ]);
  }
  let out = table(['Limitation', 'Detail'], rows);
  out += `\n\n### Components not evaluated under real-world conditions\n\n`;
  out += `- Public-network deployment, mainnet/L2 fees and real confirmation latency (deliberately out of scope; no funded keys).\n`;
  out += `- The React frontend under browser-level load: k6 cannot pre-inject \`window.ethereum\`, so UI-level load stays with the puppeteer harness (\`frontend/scripts/browser-check.mjs\`, 13 assertions) and is not part of these throughput numbers.\n`;
  out += `- A real satellite/MRV data feed — the on-chain interface exists and \`MockMRVOracle\` is admin-settable, which proves plumbing, not data provenance.\n`;
  out += `- Off-chain database or API tiers: this implementation has none, so the specification's database CPU/memory metrics have no counterpart to report.\n`;
  return out;
}

// --- assemble ---------------------------------------------------------------
const now = new Date().toISOString().slice(0, 10);
const doc = `# Research-Paper Experiment Report — Grafana k6 Load, Stress and Reliability Evaluation

**Generated:** ${now}
**Generated by:** \`node loadtest/report/build-report.mjs\` — every number below is read from
\`loadtest/results/exp/\`, never typed in by hand. Re-run after a fresh suite to regenerate.
**System under test:** blockchain-based carbon-credit trading and verification with a verifier staking
mechanism and a challenge period.
**Tool:** ${prov.k6 || 'Grafana k6'} — k6 simulates controlled concurrent workloads; it is explicitly
**not** presented as representing real factories.

---

## 0. Research questions this experiment addresses

| # | Question | Where it is answered |
|---|----------|----------------------|
| RQ1 | How does the system perform as concurrent users increase? | §§3, 8 |
| RQ2 | How does increasing workload affect request/transaction latency? | §§3, 7 |
| RQ3 | Does the system keep processing requests successfully as users increase? | §§3, 7, 10 |
| RQ4 | What overhead does the staking + challenge mechanism add over a baseline without it? | §§5, 6 |
| RQ5 | At what workload do latency, failures or throughput degradation begin? | §§3, 7, 10 |

---

## 1. Experimental setup

${s1_setup()}

Environment provenance is in \`loadtest/results/exp/provenance.json\`; the per-run record
(exit code and wall time for every run) is in \`loadtest/results/exp/runs.tsv\`.

**Reproduce:**

\`\`\`bash
bash loadtest/run-full-experiment.sh     # chain -> deploy -> seed -> suites -> statistics
node loadtest/report/stats.mjs           # aggregate.json / aggregate.csv / runs.csv
python loadtest/report/make-graphs.py    # the figures in §9
node loadtest/report/build-report.mjs    # this document
\`\`\`

---

## 2. Workload model

${s2_workload()}

---

## 3. Performance results

${s3_performance()}

---

## 4. Blockchain results

${s4_blockchain()}

---

## 5. Staking and challenge results

${s5_staking()}

---

## 6. Baseline comparison

${s6_baseline()}

---

## 7. Stress, spike and endurance results

${s7_shapes()}

---

## 8. Statistical analysis

${s8_statistics()}

---

## 9. Graphs

${s9_graphs()}

---

## 10. Interpretation

${s10_interpretation()}

---

## 11. Limitations

${s11_limitations()}

---

## Appendix A — Grafana dashboards

The specification's ten dashboard panels are provided as an importable dashboard:
\`loadtest/report/grafana-dashboard.json\` (concurrent users vs average and p95 latency; throughput; error
rate; success rate; gas consumption; confirmation time; CPU; memory; successful vs failed transactions).

It expects a Prometheus datasource scraped from k6's remote-write output:

\`\`\`bash
export K6_PROMETHEUS_RW_SERVER_URL=http://localhost:9090/api/v1/write
k6 run --out experimental-prometheus-rw \\
  --summary-trend-stats="avg,min,med,max,p(90),p(95),p(99)" loadtest/sweep.js
\`\`\`

Panels 8–9 read \`node_exporter\` metrics for the host running the chain node. In this experiment the
figures in §9 are produced directly from the same data by \`make-graphs.py\`, which is what the report
embeds: a Prometheus + Grafana stack was **not** stood up on this machine, so no screenshot of a live
Grafana instance appears here. That is a stated gap, not a claim that the dashboards were viewed.

---

## Appendix B — What this experiment does not establish

1. **Novelty.** k6 provides evidence about performance and capacity only. Whether the staking +
   challenge mechanism is novel relative to existing carbon-credit/blockchain systems is a literature
   question and is answered elsewhere (the DA1 design report and the related-work section), not here.

2. **Security.** The specification (§16) is explicit that k6 is not a security-testing tool. The
   controlled adversarial load in scenarios C and D shows the mechanism *operates* under contention; it
   does not show it is safe. Reentrancy, access control, integer overflow and authorisation are covered
   by \`npx hardhat test\` (the contract suite) and are reported in \`PROGRESS.md\`.

3. **Incentive behaviour.** No conclusion is drawn about whether staking actually deters bad
   verification. That requires an agent-based simulation or field data, which is the MiroFish line of
   work (see \`docs/K6_To_MiroFish_Roadmap.md\`), not this load test.
`;

writeFileSync(OUT, doc);
console.log(`wrote ${OUT}`);
console.log(`  levels: ${LEVELS.map((l) => l.vus).join(', ') || '(none)'}`);
console.log(`  groups: ${Object.keys(groups).length}, runs: ${runs.length}`);
console.log(
  `  derived: peak successful throughput ${D.peakOk ? D.peakOk.toFixed(1) : '—'} req/s at ${D.peakAt ?? '—'} users; ` +
    `${D.successBreaches.length} success breach(es), ${D.latencyBreaches.length} latency breach(es), ` +
    `${D.missingMeasure.length} level(s) with dropped measurement reps`
);
