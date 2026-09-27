#!/usr/bin/env bash
# Runs the release gate for one platform, then repeats its timing lines as one GitHub
# annotation, titled with the red flow or tiers, which the public API serves without a login.
# A watchdog stops the gate before the job's own limit, so the annotation always lands.
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
  echo "gate.sh: stopped the gate after ${limit_minutes} minutes" >>"$log"
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
  /took [0-9]+s|up \([0-9]+s\)|simulator up|! this emulator|! dismissed|✖|^  [✓✗] .*[0-9]s$/ { print }
  /^[^ ].* \([0-9]+ms\)$|^Format issues|^gate.sh:/ { print }
' | head -160)
last=$(printf '%s\n' "$clean" | tail -n 25)

level=notice
title="${platform} gate passed"
if [ "$status" -ne 0 ]; then
  level=error
  red=$(printf '%s\n' "$clean" |
    sed -nE 's/^ *(flow RED|console\.error during|custody RED after):? ([^(]*[^ (]).*/\1 \2/p' | head -1)
  tiers=$(printf '%s\n' "$clean" | sed -nE 's/^❌  FAIL +(.*[^ ]) {2,}.*$/\1/p; s/^❌  FAIL +(.*[^ ])$/\1/p' |
    paste -sd ';' -)
  title="${platform} gate failed: ${red:-${tiers:-exit ${status}}}"
fi
escape_property() { printf '%s' "$1" | sed 's/%/%25/g; s/:/%3A/g; s/,/%2C/g'; }
message=$(printf '%s\n%s\n\n— last lines —\n%s' "$host" "$lines" "$last" |
  sed 's/%/%25/g' | awk '{printf "%s%%0A", $0}')
echo "::${level} title=$(escape_property "$title")::${message}"
exit "$status"
