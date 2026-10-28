#!/bin/sh
# Installs Symbiote from this checkout in one command (IN1): ./install.sh [--no-app]
# It needs git and Node 22.12 or newer; the steps are scripts/install.mjs's. Run it again after
# `git pull` to update.
set -e
here=$(cd "$(dirname "$0")" && pwd)
if ! command -v node >/dev/null 2>&1; then
  echo "symbiote install: Symbiote needs Node 22.12 or newer, and there is no node on PATH." >&2
  echo "  Install it from https://nodejs.org, or with nvm: nvm install 24" >&2
  exit 1
fi
version=$(node -p process.versions.node)
major=${version%%.*}
rest=${version#*.}
minor=${rest%%.*}
if [ "$major" -lt 22 ] || { [ "$major" -eq 22 ] && [ "$minor" -lt 12 ]; }; then
  echo "symbiote install: Symbiote needs Node 22.12 or newer; this is $version." >&2
  echo "  Install a newer one from https://nodejs.org, or with nvm: nvm install 24" >&2
  exit 1
fi
exec node "$here/scripts/install.mjs" "$@"
