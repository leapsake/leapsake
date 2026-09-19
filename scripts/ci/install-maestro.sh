#!/usr/bin/env bash
# Installs the Maestro CLI the device tiers drive, at the version the repo is tested with.
set -euo pipefail

export MAESTRO_VERSION=2.8.0
curl -fsSL https://get.maestro.mobile.dev | bash
"$HOME/.maestro/bin/maestro" --version
