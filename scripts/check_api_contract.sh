#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

openapi_json="$tmp_dir/openapi.json"
generated_ts="$tmp_dir/generated.ts"
tracked_generated="$repo_root/webui/src/api/generated.ts"

if docker compose version >/dev/null 2>&1; then
  compose=(docker compose)
elif docker-compose version >/dev/null 2>&1; then
  compose=(docker-compose)
else
  echo "Neither 'docker compose' nor 'docker-compose' is available." >&2
  exit 1
fi

echo "Building backend image..."
"${compose[@]}" -f "$repo_root/docker-compose.yml" build xarchiver

echo "Dumping backend OpenAPI schema..."
"${compose[@]}" -f "$repo_root/docker-compose.yml" run --rm --entrypoint python xarchiver -c \
  "import json; from xarchiver.api.app import create_app; print(json.dumps(create_app().openapi(), ensure_ascii=False, indent=2))" \
  > "$openapi_json"

echo "Generating temporary TypeScript API contract..."
npm --prefix "$repo_root/webui" exec -- openapi-typescript "$openapi_json" -o "$generated_ts"

echo "Comparing generated API contract with tracked webui/src/api/generated.ts..."
if ! diff -u "$tracked_generated" "$generated_ts"; then
  cat <<'EOF'

API contract drift detected.
Run the following command and commit the updated generated file:

  cd webui && npm run generate:api-types

EOF
  exit 1
fi

echo "API contract is up to date."
