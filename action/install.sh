#!/usr/bin/env bash
# Builds CPR from this checkout of the action (the packages are not published).
set -euo pipefail
pnpm=(npx --yes pnpm@12.8.1)
"${pnpm[@]}" install --frozen-lockfile --silent
"${pnpm[@]}" run build >/dev/null
