#!/usr/bin/env bash
set -euo pipefail

if docker compose version >/dev/null 2>&1; then
  compose=(docker compose)
elif docker-compose version >/dev/null 2>&1; then
  compose=(docker-compose)
else
  echo "Neither 'docker compose' nor 'docker-compose' is available." >&2
  exit 127
fi

"${compose[@]}" run --rm --no-deps --entrypoint python xarchiver \
  -m ruff check --config /app/pyproject.toml /app/xarchiver /app/tests
