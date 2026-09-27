#!/usr/bin/env bash
# Readies a hosted runner for one platform's device tiers: the Android emulator where it
# is needed, and Maestro for both.
set -euo pipefail

here="$(dirname "$0")"
if [ "$1" = "android" ]; then bash "$here/android-host.sh"; fi
bash "$here/install-maestro.sh"
