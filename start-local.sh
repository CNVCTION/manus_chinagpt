#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
if [ ! -f .env ]; then
  echo "Missing .env. Copy .env.example to .env and set APIFY_API_TOKEN privately." >&2
  exit 1
fi
set -a
# shellcheck disable=SC1091
. ./.env
set +a
exec node src/server.js
