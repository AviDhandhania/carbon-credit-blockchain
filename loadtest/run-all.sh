#!/usr/bin/env bash
# Runs the full k6 suite against the local chain and collects artifacts.
#
# Prereqs (fresh chain state):
#   npx hardhat node
#   npx hardhat run scripts/deploy.js --network localhost
#   npx hardhat run loadtest/setup-roles.js --network localhost
#
# Usage:  bash loadtest/run-all.sh [r1 r2 r3 ...]   (default: all)
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
OUT="$HERE/results"

# Locate k6 across environments (see run-experiments.sh for rationale).
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
mkdir -p "$OUT"

cd "$ROOT"
# shellcheck disable=SC1091
set -a; . "$HERE/.state.env"; set +a

if [ -z "$K6" ]; then
  echo "k6 not found on PATH or at the standard install locations (set K6=/path/to/k6)" >&2
  exit 2
fi

SCENARIOS=("$@")
if [ ${#SCENARIOS[@]} -eq 0 ]; then
  SCENARIOS=(r1 r2 r3 r4 r5 r6 r7)
fi

: > "$OUT/exits.txt"
for s in "${SCENARIOS[@]}"; do
  # Quoted prefix + glob on the last segment: the repo path contains a space.
  matches=("$HERE"/$s-*.js)
  file="${matches[0]}"
  if [ ! -f "$file" ]; then
    echo "skip $s (no script)" | tee -a "$OUT/exits.txt"
    continue
  fi
  echo "=== $s : $(basename "$file") ==="
  "$K6" run "$file" --summary-export "$OUT/$s.summary.json" \
    > "$OUT/$s.log" 2>&1
  code=$?
  echo "$s exit=$code" | tee -a "$OUT/exits.txt"
  tail -3 "$OUT/$s.log"
done

echo
echo "artifacts in $OUT"
cat "$OUT/exits.txt"
