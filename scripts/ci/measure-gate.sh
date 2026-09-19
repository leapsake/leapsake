#!/usr/bin/env bash
# Throwaway (remote-releases.md step 6): runs the gate for one platform, then repeats its
# timing lines as one GitHub annotation, which the public API serves without a login.
# A watchdog stops the gate before the job's own limit, so the annotation always lands.
# Deleted with .github/workflows/measure.yml.
set -uo pipefail

platform="$1"
limit_minutes="${2:-120}"
log="$(mktemp)"

set -m
pnpm release gate --platforms="$platform" >"$log" 2>&1 &
gate=$!
set +m
tail -n +1 -f "$log" &
tailer=$!
(
  sleep $((limit_minutes * 60))
  echo "measure-gate: stopped the gate after ${limit_minutes} minutes" >>"$log"
  kill -TERM -- "-$gate" 2>/dev/null
) &
watchdog=$!

wait "$gate"
status=$?
kill "$watchdog" "$tailer" 2>/dev/null

host="$(uname -s), $(getconf _NPROCESSORS_ONLN) cores"
clean=$(sed -E 's/\x1b\[[0-9;]*m//g' "$log")
lines=$(printf '%s\n' "$clean" | awk '
  /^  ✗ / { for (i = 1; i <= 15; i++) if (before[(n + i) % 15] != "") print "    | " before[(n + i) % 15] }
  { before[n = (n + 1) % 15] = $0 }
  /^(✅|❌|⏳) / { print; detail = /^(❌|⏳)/; next }
  detail && /^      / { print; next }
  { detail = 0 }
  /took [0-9]+s|up \([0-9]+s\)|simulator up|! this emulator|✖|^  [✓✗] .*[0-9]s$/ { print }
  /^[^ ].* \([0-9]+ms\)$|^Format issues|^measure-gate:/ { print }
' | head -120)
last=$(printf '%s\n' "$clean" | tail -n 25)
message=$(printf '%s\n%s\n\n— last lines —\n%s' "$host" "$lines" "$last" |
  sed 's/%/%25/g' | awk '{printf "%s%%0A", $0}')
echo "::notice title=${platform} gate, exit ${status}::${message}"
exit "$status"
