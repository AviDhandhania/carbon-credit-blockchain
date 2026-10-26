#!/usr/bin/env bash
# Orchestrates the research-paper experiment suite and collects artifacts.
#
# Prereqs (fresh chain):
#   npx hardhat node
#   npx hardhat run scripts/deploy.js --network localhost
#   npx hardhat run loadtest/setup-roles.js --network localhost
#   POOL=400 npx hardhat run loadtest/setup-experiment.js --network localhost
#
# Usage:
#   bash loadtest/run-experiments.sh                     # everything, default sizes
#   REPS=3 LEVELS="10 50 100" SUITES="sweep" bash loadtest/run-experiments.sh
#
# Every run writes, under loadtest/results/exp/:
#   <run>.log            raw k6 output
#   <run>.summary.json   k6 --summary-export (tag-grouped sub-metrics included)
#   <run>.resources.csv  node/system CPU + RAM sampled during the run
# plus runs.tsv (name, exit code, wall ms, start, script, args), exits.txt and
# provenance.json (who/what/when, so a number in the report can be traced back).
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
OUT="$HERE/results/exp"

# Locate k6 across environments: Git Bash (/c/...), WSL (/mnt/c/...), or PATH.
# An explicit K6 wins; a k6 on PATH wins next (so a native Linux k6 is used
# under WSL); otherwise the standard Windows install paths are tried. Ordering
# matters: under WSL the Windows k6.exe cannot reach a WSL-hosted chain over
# 127.0.0.1, so a native k6 must take precedence when present.
resolve_k6() {
  local cand
  for cand in "${K6:-}" "k6" \
              "/c/Program Files/k6/k6.exe" \
              "/mnt/c/Program Files/k6/k6.exe" \
              "/c/Program Files/k6/k6"; do
    [ -n "$cand" ] || continue
    if [ -x "$cand" ] || command -v "$cand" >/dev/null 2>&1; then
      printf '%s\n' "$cand"
      return 0
    fi
  done
  return 1
}
K6="$(resolve_k6)" || K6=""

REPS="${REPS:-3}"
LEVELS="${LEVELS:-10 50 100 250 500 1000}"
WARMUP="${WARMUP:-60s}"
MEASURE="${MEASURE:-180s}"
COOLDOWN="${COOLDOWN:-30s}"
SUITES="${SUITES:-sweep baseline staking stress spike endurance}"
# Fixed-size arms
BASE_VUS="${BASE_VUS:-10}"
BASE_ITERS="${BASE_ITERS:-20}"
STAKING_VUS="${STAKING_VUS:-5}"
STAKING_ITERS="${STAKING_ITERS:-8}"
STRESS_REPS="${STRESS_REPS:-2}"
SPIKE_REPS="${SPIKE_REPS:-2}"
ENDURANCE_REPS="${ENDURANCE_REPS:-1}"

mkdir -p "$OUT"
cd "$ROOT"

# shellcheck disable=SC1091
set -a
. "$HERE/.state.env"
. "$HERE/.experiment.env"
set +a

if [ -z "$K6" ]; then
  echo "k6 not found on PATH or at the standard install locations." >&2
  echo "Install it (https://grafana.com/docs/k6/latest/set-up/install-k6/) or set K6=/path/to/k6" >&2
  exit 2
fi
echo "  using k6: $K6"

# --- provenance -------------------------------------------------------------
chain_up() {
  node -e "
    fetch('http://127.0.0.1:8545',{method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({jsonrpc:'2.0',id:1,method:'eth_blockNumber',params:[]})})
      .then(r=>r.json()).then(j=>process.exit(j.result?0:1)).catch(()=>process.exit(1))" 2>/dev/null
}

write_provenance() {
  local gitrev nodev k6v host cpu mem
  gitrev="$(git rev-parse HEAD 2>/dev/null || echo unknown)"
  local dirty; dirty="$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')"
  nodev="$(node -v)"
  k6v="$("$K6" version 2>&1 | head -1)"
  host="$(hostname)"
  cpu="$(node -e "console.log(require('os').cpus()[0].model + ' x' + require('os').cpus().length)")"
  mem="$(node -e "console.log((require('os').totalmem()/1073741824).toFixed(1) + ' GiB')")"
  cat > "$OUT/provenance.json" <<EOF
{
  "recordedAt": "$(date -u +%FT%TZ)",
  "gitRevision": "$gitrev",
  "gitDirtyFiles": $dirty,
  "node": "$nodev",
  "k6": $(node -e "console.log(JSON.stringify(process.argv[1]))" "$k6v"),
  "host": $(node -e "console.log(JSON.stringify(process.argv[1]))" "$host"),
  "cpu": $(node -e "console.log(JSON.stringify(process.argv[1]))" "$cpu"),
  "memory": "$mem",
  "rpcUrl": "http://127.0.0.1:8545",
  "chain": "Hardhat node (automine, in-process EVM, 20 unlocked accounts)",
  "baselineContract": "$BASELINE_ADDR",
  "batchPool": $POOL_SIZE,
  "multisig": "${MULTISIG_THRESHOLD}-of-$(echo "$MULTISIG_OWNERS" | tr ',' '\n' | wc -l | tr -d ' ')",
  "levels": $(node -e "console.log(JSON.stringify(process.argv[1].split(/\s+/)))" "$LEVELS"),
  "repetitions": $REPS,
  "phases": { "warmup": "$WARMUP", "measure": "$MEASURE", "cooldown": "$COOLDOWN" }
}
EOF
  echo "provenance -> $OUT/provenance.json"
}

: > "$OUT/exits.txt"
: > "$OUT/runs.tsv"
echo -e "run\texit\twall_ms\tstarted_at\tscript\targs" > "$OUT/runs.tsv"
write_provenance

# --- one run ----------------------------------------------------------------
run_one() {
  local name="$1"; local script="$2"; shift 2
  local log="$OUT/$name.log" sum="$OUT/$name.summary.json" res="$OUT/$name.resources.csv"

  if ! chain_up; then
    echo "$name exit=CHAIN_DOWN (skipped)" | tee -a "$OUT/exits.txt"
    echo -e "$name\tCHAIN_DOWN\t0\t-\t$script\t$*" >> "$OUT/runs.tsv"
    return 1
  fi

  node "$HERE/monitor.mjs" --out "$res" --interval 2000 > "$OUT/$name.monitor.log" 2>&1 &
  local mon=$!
  local t0; t0="$(date +%s%3N)"
  local started; started="$(date -u +%FT%TZ)"

  # --summary-trend-stats: k6's default trend stats stop at p(95), and the
  # report needs p(99) ("particularly important" per the spec). The flag also
  # applies to the tag-grouped sub-metrics.
  "$K6" run "$script" --summary-export "$sum" \
    --summary-trend-stats="avg,min,med,max,p(90),p(95),p(99)" "$@" > "$log" 2>&1
  local code=$?

  local t1; t1="$(date +%s%3N)"
  kill "$mon" 2>/dev/null
  wait "$mon" 2>/dev/null

  echo "$name exit=$code wall=$(( (t1 - t0) / 1000 ))s" | tee -a "$OUT/exits.txt"
  echo -e "$name\t$code\t$((t1 - t0))\t$started\t$script\t$*" >> "$OUT/runs.tsv"
  return 0
}

want() { for s in $SUITES; do [ "$s" = "$1" ] && return 0; done; return 1; }

echo "=== experiment suite: suites=[$SUITES] reps=$REPS levels=[$LEVELS] ==="
echo "=== phases: warm-up $WARMUP, measurement $MEASURE, cool-down $COOLDOWN ==="

# --- 1. workload levels (§4, §5) --------------------------------------------
if want sweep; then
  for vus in $LEVELS; do
    for r in $(seq 1 "$REPS"); do
      run_one "sweep__vus${vus}__r${r}" "$HERE/sweep.js" \
        --env "TARGET_VUS=$vus" --env "WARMUP=$WARMUP" --env "MEASURE=$MEASURE" --env "COOLDOWN=$COOLDOWN"
    done
  done
fi

# --- 2. baseline vs proposed (§9) -------------------------------------------
if want baseline; then
  for mode in baseline nostake stake; do
    for r in $(seq 1 "$REPS"); do
      run_one "baseline__${mode}__r${r}" "$HERE/baseline.js" \
        --env "MODE=$mode" --env "TARGET_VUS=$BASE_VUS" --env "ITERATIONS=$BASE_ITERS"
    done
  done
fi

# --- 3. staking / challenge scenarios (§8) ----------------------------------
if want staking; then
  for scen in A B C D; do
    for r in $(seq 1 "$REPS"); do
      if [ "$scen" = "D" ]; then
        run_one "staking__${scen}__r${r}" "$HERE/staking.js" \
          --env "SCENARIO=$scen" --env "TARGET_VUS=$STAKING_VUS" --env "ITERATIONS=2"
      else
        run_one "staking__${scen}__r${r}" "$HERE/staking.js" \
          --env "SCENARIO=$scen" --env "TARGET_VUS=$STAKING_VUS" --env "ITERATIONS=$STAKING_ITERS"
      fi
    done
  done
fi

# --- 4. stress (§13) --------------------------------------------------------
if want stress; then
  for r in $(seq 1 "$STRESS_REPS"); do
    run_one "stress__r${r}" "$HERE/sweep.js" --env "SHAPE=stress"
  done
fi

# --- 5. spike (§14) ---------------------------------------------------------
if want spike; then
  for r in $(seq 1 "$SPIKE_REPS"); do
    run_one "spike__r${r}" "$HERE/sweep.js" --env "SHAPE=spike"
  done
fi

# --- 6. endurance (§15) -----------------------------------------------------
if want endurance; then
  for r in $(seq 1 "$ENDURANCE_REPS"); do
    run_one "endurance__r${r}" "$HERE/sweep.js" --env "SHAPE=endurance"
  done
fi

echo
echo "artifacts in $OUT"
cat "$OUT/exits.txt"
