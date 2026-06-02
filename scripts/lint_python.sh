#!/usr/bin/env bash
set -euo pipefail

docker-compose run --rm --no-deps --entrypoint python xarchiver \
  -m ruff check --config /app/pyproject.toml /app/xarchiver /app/tests
