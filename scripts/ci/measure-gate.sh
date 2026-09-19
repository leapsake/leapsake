#!/usr/bin/env bash
# Throwaway (remote-releases.md step 6): runs the gate for one platform, then repeats its
# timing lines as one GitHub annotation, which the public API serves without a login.
# Deleted with .github/workflows/measure.yml.
set -uo pipefail

platform="$1"
log="$(mktemp)"
pnpm release gate --platforms="$platform" 2>&1 | tee "$log"
status=${PIPESTATUS[0]}

host="$(uname -s), $(getconf _NPROCESSORS_ONLN) cores"
lines=$(sed -E 's/\x1b\[[0-9;]*m//g' "$log" |
  grep -E 'took [0-9]+s|^ +[✓✗] |up \([0-9]+s\)|simulator up|^(✅|❌|⏳) |! this emulator')
message=$(printf '%s\n%s' "$host" "$lines" | sed 's/%/%25/g' | awk '{printf "%s%%0A", $0}')
echo "::notice title=${platform} gate, exit ${status}::${message}"
exit "$status"
