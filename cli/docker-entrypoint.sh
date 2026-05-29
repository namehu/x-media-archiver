#!/usr/bin/env bash
# Container entrypoint for the self-contained x-media-archiver image.
#
# Default behaviour (no args, or first arg is "serve"):
#   1. Apply database migrations (idempotent, checksum-guarded).
#   2. Start the API server bound to 0.0.0.0:8000.
#
# The container always listens on the fixed internal port 8000 (matching EXPOSE).
# To publish it on a different host port, change the compose port mapping
# (API_PORT in .env.production), not the in-container port.
#
# Any other arguments are passed straight through to the CLI, e.g.:
#   docker run --rm xma db reset --yes
#   docker run --rm xma import-urls /app/examples/tweet_urls.example.txt
set -euo pipefail

if [ "$#" -eq 0 ] || [ "$1" = "serve" ]; then
  echo "[entrypoint] applying database migrations..."
  python -m xarchiver.cli db migrate
  echo "[entrypoint] starting API server on 0.0.0.0:8000..."
  exec python -m xarchiver.cli serve --host 0.0.0.0 --port 8000
fi

exec python -m xarchiver.cli "$@"
