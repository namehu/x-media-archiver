# syntax=docker/dockerfile:1.7

# Self-contained production image: builds the React WebUI and bakes it into the
# Python CLI/API image so the server serves both from a single origin.
#
# Build context is the repository root (the WebUI lives outside ./cli):
#   docker build -t x-media-archiver .

# ---- Stage 1: build the WebUI ------------------------------------------------
FROM node:22-slim AS webui-builder

WORKDIR /webui

# Install dependencies first for better layer caching.
COPY webui/package.json webui/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm,sharing=locked \
    npm ci

# The generated API types are committed, so the build does not need the backend.
COPY webui/ ./
RUN npm run build

# ---- Stage 2: runtime --------------------------------------------------------
FROM python:3.12-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    API_HOST=0.0.0.0 \
    WEBUI_DIST=/app/webui

WORKDIR /app

RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt/lists,sharing=locked \
    rm -f /etc/apt/apt.conf.d/docker-clean \
    && apt-get update \
    && apt-get install -y --no-install-recommends \
    ffmpeg \
    ca-certificates \
    curl \
    git

# Python dependencies.
COPY cli/requirements.txt /app/requirements.txt
RUN --mount=type=cache,target=/root/.cache/pip,sharing=locked \
    python -m pip install --upgrade pip \
    && python -m pip install -r /app/requirements.txt

# Backend source (xarchiver package, Alembic migrations, gallery-dl.conf, entrypoint).
COPY --chmod=755 cli/docker-entrypoint.sh /app/docker-entrypoint.sh
COPY cli/xarchiver/ /app/xarchiver/
COPY cli/gallery-dl.conf /app/gallery-dl.conf

# Built WebUI from stage 1.
COPY --from=webui-builder /webui/dist /app/webui

EXPOSE 18000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD curl -fsS "http://127.0.0.1:18000/health" || exit 1

ENTRYPOINT ["/app/docker-entrypoint.sh"]
