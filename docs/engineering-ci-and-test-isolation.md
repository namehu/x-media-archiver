# Engineering CI and Test Isolation

P3 first stage keeps the validation pipeline small and runnable:

```text
backend unittest in Docker
webui typecheck + build
extension typecheck + build
```

## Backend

Backend tests run inside the same Docker image used by local development. The CI job resets the
metadata database before running tests:

```bash
docker-compose run --rm xarchiver db reset --yes
docker-compose run --rm --entrypoint python xarchiver -m unittest discover -s /app/tests
```

The reset is intentional. This project is still new, and the integration tests use the configured
Postgres database directly. A clean database avoids leaking local exploratory runs into automated
test results.

Do not provide real X/Twitter cookies in CI. Tests must use mocks, fixture metadata, or local files.

## Frontend

WebUI validation uses:

```bash
cd webui
npm run check
```

At this stage `check` delegates to the existing TypeScript and Vite build. Lint and generated API
types are planned P3 follow-ups, not prerequisites for this first CI slice.

Extension validation uses:

```bash
cd extension
npm run check
```

This runs WXT type preparation, TypeScript checking, and the production extension build.

## Local Rule

When a change touches queue state, source scanning, database migrations, or download path behavior,
run the backend Docker test command before handing it off. When a change touches WebUI or extension
code, run the matching `npm run check` command in that package.
