#!/usr/bin/env bash
# Thin wrapper: find node and run the installer.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NODE_BIN="${NODE_BIN:-$(command -v node || true)}"

if [[ -z "$NODE_BIN" ]]; then
  echo "ollama-quota: node not found in PATH" >&2
  exit 1
fi

exec "$NODE_BIN" "$DIR/ollama-quota.mjs" install "$@"
