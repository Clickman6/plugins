#!/usr/bin/env bash
# Run the self-test in a throwaway container; nothing is installed on the host.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"
IMAGE="${NODE_IMAGE:-node:22-alpine}"

docker run --rm -v "$PWD:/app" -w /app "$IMAGE" node ollama-quota.mjs selftest
