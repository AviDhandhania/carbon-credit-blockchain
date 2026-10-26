#!/usr/bin/env bash
# ONE-COMMAND full experiment run (research paper, specification §4-§15).
#
#   cd "/c/Users/SHIVESH KUMAR/Desktop/carbon-credit-blockchain"
#   bash loadtest/run-full-experiment.sh
#
# It does everything, in order:
#   1. frees port 8545 (kills any node already there)
#   2. starts a fresh `npx hardhat node`
#   3. deploys the 6 product contracts
#   4. provisions roles + seed listings            (loadtest/setup-roles.js)
#   5. deploys BaselineVerifier, stakes, batch pool (loadtest/setup-experiment.js)
#   6. runs the suite: workload levels x reps, baseline arms, staking A-D,
#      stress, spike, endurance                     (loadtest/run-experiments.sh)
#   7. aggregates statistics into aggregate.json/csv (loadtest/report/stats.mjs)
#
# Expected runtime with the defaults: ~2.5-3 hours (dominated by the spec's own
# 60s warm-up + 180s measurement + 30s cool-down windows x 6 levels x 3 reps).
#
# Override anything by putting it before the command, e.g.
#   REPS=2 LEVELS="10 50 100" MEASURE=120s bash loadtest/run-full-experiment.sh
#
# Artifacts land in loadtest/results/exp/ (per-run .log, .summary.json,
# .resources.csv, plus runs.tsv, aggregate.json, aggregate.csv, provenance.json).
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
LOG="$ROOT/hardhat-node.log"
PORT="${PORT:-8545}"

# Full-strength defaults; every one of these can be overridden from the caller.
export REPS="${REPS:-3}"
export LEVELS="${LEVELS:-10 50 100 250 500 1000}"
export WARMUP="${WARMUP:-60s}"
export MEASURE="${MEASURE:-180s}"
export COOLDOWN="${COOLDOWN:-30s}"
export SUITES="${SUITES:-sweep baseline staking stress spike endurance}"
export STRESS_REPS="${STRESS_REPS:-2}"
export SPIKE_REPS="${SPIKE_REPS:-2}"
export ENDURANCE_REPS="${ENDURANCE_REPS:-1}"
export POOL="${POOL:-400}"

free_port() {
  local pid
  pid="$(netstat -ano 2>/dev/null | grep -E "LISTENING" | grep ":$PORT " | awk '{print $NF}' | head -1)"
  if [ -n "$pid" ]; then
    echo "  freeing port $PORT (pid $pid)"
    taskkill //PID "$pid" //F >/dev/null 2>&1 || true
    sleep 2
  fi
}

wait_for_chain() {
  local tries=0
  until node -e "
    fetch('http://127.0.0.1:$PORT',{method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({jsonrpc:'2.0',id:1,method:'eth_blockNumber',params:[]})})
      .then(r=>r.json()).then(j=>process.exit(j.result?0:1)).catch(()=>process.exit(1))" 2>/dev/null; do
    tries=$((tries + 1))
    if [ "$tries" -gt 60 ]; then
      echo "chain did not come up on port $PORT after 60s — see $LOG" >&2
      exit 1
    fi
    sleep 1
  done
}

step() { echo; echo "########## $* ##########"; }

cat <<BANNER
============================================================
 Carbon-credit blockchain — full k6 experiment run
============================================================
 levels         : $LEVELS
 repetitions    : $REPS per level
 phases         : warm-up $WARMUP / measurement $MEASURE / cool-down $COOLDOWN
 suites         : $SUITES
 stress/spike   : ${STRESS_REPS}x / ${SPIKE_REPS}x
 endurance      : ${ENDURANCE_REPS}x 100 VUs for ~30 min
 batch pool     : $POOL
 expected time  : ~2.5-3 hours
============================================================
BANNER

cd "$ROOT"

step "1/7 resetting chain"
free_port

step "2/7 starting hardhat node"
: > "$LOG"
nohup npx hardhat node > "$LOG" 2>&1 &
wait_for_chain
echo "  node is up on 127.0.0.1:$PORT (log: $LOG)"

step "3/7 deploying the 6 product contracts"
npx hardhat run scripts/deploy.js --network localhost 2>&1 | tail -12 || exit 1

step "4/7 provisioning roles and seed state"
npx hardhat run loadtest/setup-roles.js --network localhost 2>&1 | tail -8 || exit 1

step "5/7 deploying BaselineVerifier, staking and the batch pool"
POOL="$POOL" npx hardhat run loadtest/setup-experiment.js --network localhost 2>&1 | tail -8 || exit 1

step "6/7 running the suite (~2.5-3 h — progress below, one line per run)"
rm -rf "$HERE/results/exp"
bash "$HERE/run-experiments.sh"

step "7/7 aggregating statistics"
node "$HERE/report/stats.mjs"

cat <<DONE

============================================================
 DONE. Artifacts: $HERE/results/exp
   runs.tsv        one line per run (exit code + wall time)
   runs.csv        per-run throughput / latency / errors
   aggregate.json  per-group mean, median, stdev, variance, min, max, p90/p95/p99, ci95
   aggregate.csv   flat table for graphing
   provenance.json git revision, versions, host, cpu, levels, repetitions
   <run>.log / .summary.json / .resources.csv
============================================================
 The Hardhat node is still running so you can inspect the chain.
 To stop it:  netstat -ano | grep :$PORT     then  taskkill //PID <pid> //F
============================================================
DONE
