#!/usr/bin/env node
/**
 * Resource monitor for the experiment runs (specification §11).
 *
 * Samples, every INTERVAL ms, into a CSV:
 *   - the blockchain node process CPU (derived from cumulative CPU seconds) and
 *     working set (RSS);
 *   - system-wide CPU load and free/total physical memory.
 *
 *   node loadtest/monitor.mjs --out loadtest/results/exp/run.resources.csv --interval 2000
 *   node loadtest/monitor.mjs --pid 1234 ...      # skip node-process discovery
 *
 * Stops on SIGINT/SIGTERM, or after --seconds. On Windows the samples come from
 * PowerShell/CIM; on other platforms from `ps`. Only what can actually be
 * measured is written — a missing reading is an empty cell, never a zero, so the
 * report can distinguish "idle" from "not sampled".
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync, writeFileSync } from 'node:fs';
import { argv } from 'node:process';

function arg(name, dflt) {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
}

const OUT = arg('out');
const INTERVAL = Number(arg('interval', '2000'));
const SECONDS = Number(arg('seconds', '0'));
let PID = arg('pid', '');

if (!OUT) {
  console.error('usage: node loadtest/monitor.mjs --out <csv> [--pid N] [--interval ms] [--seconds N]');
  process.exit(2);
}

/** PID of the process listening on the RPC port, or '' */
function discoverPid() {
  try {
    const port = (arg('port', '8545') || '8545');
    const out = execFileSync('netstat', ['-ano'], { encoding: 'utf8' });
    for (const line of out.split(/\r?\n/)) {
      if (line.includes(`:${port}`) && /LISTENING/i.test(line)) {
        const cols = line.trim().split(/\s+/);
        return cols[cols.length - 1];
      }
    }
  } catch {
    /* fall through */
  }
  return '';
}

const IS_WIN = process.platform === 'win32';

/** one sample; every field is a string, '' when unavailable */
function sampleWin(pid) {
  const ps = `
$ErrorActionPreference='SilentlyContinue'
$p = if ('${pid}' -ne '') { Get-Process -Id ${pid || 0} } else { $null }
$os = Get-CimInstance Win32_OperatingSystem
$cpu = (Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average
[pscustomobject]@{
  node_cpu_sec = if ($p -and $p.CPU -ne $null) { [string]$p.CPU } else { '' }
  node_rss_mb  = if ($p -and $p.WorkingSet64) { [string][math]::Round($p.WorkingSet64/1MB,1) } else { '' }
  sys_cpu_pct  = if ($cpu -ne $null) { [string][math]::Round($cpu,1) } else { '' }
  mem_free_mb  = if ($os) { [string][math]::Round($os.FreePhysicalMemory/1KB,1) } else { '' }
  mem_total_mb = if ($os) { [string][math]::Round($os.TotalVisibleMemorySize/1KB,1) } else { '' }
} | ConvertTo-Json -Compress
`;
  try {
    const txt = execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], {
      encoding: 'utf8',
      timeout: 15000,
    }).trim();
    const start = txt.indexOf('{');
    const j = JSON.parse(txt.slice(start, txt.lastIndexOf('}') + 1));
    return j;
  } catch {
    return {};
  }
}

function samplePosix(pid) {
  const out = {};
  try {
    if (pid) {
      const ps = execFileSync('ps', ['-o', 'cputime=,rss=', '-p', String(pid)], { encoding: 'utf8' }).trim();
      const [cput, rss] = ps.split(/\s+/);
      out.node_cpu_sec = cput;
      out.node_rss_mb = rss ? String(Math.round(Number(rss) / 1024)) : '';
    }
  } catch {
    /* unavailable */
  }
  return out;
}

/** seconds -> total CPU seconds, accepting both "123.45" and "01:20:30" */
function parseCpu(v) {
  if (v === undefined || v === '' || v === null) return null;
  const s = String(v);
  if (s.includes(':')) {
    const parts = s.split(':').map(Number);
    return parts.length === 3 ? parts[0] * 3600 + parts[1] * 60 + parts[2] : parts[0] * 60 + parts[1];
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

if (!PID) PID = discoverPid();
console.log(`monitor: out=${OUT} interval=${INTERVAL}ms pid=${PID || '(unavailable)'} platform=${process.platform}`);

writeFileSync(OUT, 'epoch_ms,iso,node_cpu_sec,node_cpu_pct,node_rss_mb,sys_cpu_pct,mem_free_mb,mem_total_mb\n');

let prevCpu = null;
let prevT = null;
let stop = false;
process.on('SIGINT', () => (stop = true));
process.on('SIGTERM', () => (stop = true));

function tick() {
  const t = Date.now();
  const s = IS_WIN ? sampleWin(PID) : samplePosix(PID);
  const cpuSec = parseCpu(s.node_cpu_sec);
  let cpuPct = '';
  if (cpuSec !== null && prevCpu !== null && prevT !== null && t > prevT) {
    // CPU time consumed by one process over wall-clock time: >100% means
    // multi-threaded, which is exactly what a Node-based chain node can do.
    cpuPct = (((cpuSec - prevCpu) / ((t - prevT) / 1000)) * 100).toFixed(1);
  }
  if (cpuSec !== null) {
    prevCpu = cpuSec;
    prevT = t;
  }
  const row = [
    t,
    new Date(t).toISOString(),
    cpuSec === null ? '' : cpuSec,
    cpuPct,
    s.node_rss_mb ?? '',
    s.sys_cpu_pct ?? '',
    s.mem_free_mb ?? '',
    s.mem_total_mb ?? '',
  ].join(',');
  appendFileSync(OUT, row + '\n');
}

tick();
const started = Date.now();
const timer = setInterval(() => {
  if (stop || (SECONDS > 0 && Date.now() - started >= SECONDS * 1000)) {
    clearInterval(timer);
    console.log('monitor: stopping');
    process.exit(0);
  }
  tick();
}, INTERVAL);
