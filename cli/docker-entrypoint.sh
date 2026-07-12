#!/usr/bin/env bash
# Container entrypoint for the self-contained x-media-archiver image.
#
# Default behaviour (no args, or first arg is "serve"):
#   1. Apply Alembic database migrations.
#   2. Start the API server bound to 0.0.0.0:18000.
#
# The container always listens on the fixed API port 18000 (matching EXPOSE).
#
# Any other arguments are passed straight through to the CLI, e.g.:
#   docker run --rm xma db reset --yes
#   docker run --rm xma import-urls /app/examples/tweet_urls.example.txt
set -euo pipefail

if [ "$#" -eq 0 ] || [ "$1" = "serve" ]; then
  echo "[entrypoint] applying database migrations..."
  python -m xarchiver.cli db migrate
  echo "[entrypoint] starting API server on 0.0.0.0:18000..."
  exec python -m xarchiver.cli serve --host 0.0.0.0 --port 18000
fi

exec python -m xarchiver.cli "$@"
