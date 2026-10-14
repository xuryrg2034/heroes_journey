#!/usr/bin/env bash
# Full project check. Usage: verify.sh [--browser] [--only pattern]
# Prints one PASS/FAIL line per step and a dated summary; logs go to $LOG_DIR.
set -u
cd "$(dirname "$0")/../../../.." || exit 2
BROWSER=0; ONLY=""
while [ $# -gt 0 ]; do
  case "$1" in
    --browser) BROWSER=1 ;;
    --only) ONLY="$2"; shift ;;
  esac
  shift
done
LOG_DIR="${LOG_DIR:-${TMPDIR:-/tmp}/ashen-verify}"; mkdir -p "$LOG_DIR"
pass=0; fail=0; failed=()
step() {
  local name="$1"; shift
  local log="$LOG_DIR/${name//[:\/ ]/_}.log" start=$SECONDS
  if "$@" >"$log" 2>&1; then pass=$((pass+1)); echo "PASS $name ($((SECONDS-start))s)"
  else fail=$((fail+1)); failed+=("$name"); echo "FAIL $name ($((SECONDS-start))s) -> $log"; tail -n 15 "$log" | sed 's/^/    /'; fi
}
step typecheck npx tsc --noEmit
for s in $(node -e 'console.log(Object.keys(require("./package.json").scripts).filter(k=>k.startsWith("test:")).join(" "))'); do
  if [ -n "$ONLY" ] && [[ "$s" != *"$ONLY"* ]]; then continue; fi
  step "$s" npm run -s "$s"
done
[ -z "$ONLY" ] && step build npm run -s build
[ "$BROWSER" = 1 ] && step playwright env NO_PROXY=127.0.0.1,localhost npx playwright test
echo "----"
echo "$(date '+%Y-%m-%d %H:%M') verify: $pass passed, $fail failed${failed:+: ${failed[*]}}"
echo "logs: $LOG_DIR"
[ "$fail" = 0 ]
