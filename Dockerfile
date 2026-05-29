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
RUN npm ci

# The generated API types are committed, so the build does not need the backend.
COPY webui/ ./
RUN npm run build

# ---- Stage 2: runtime --------------------------------------------------------
FROM python:3.12-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    API_HOST=0.0.0.0 \
    WEBUI_DIST=/app/webui

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    ca-certificates \
    curl \
    git \
    && rm -rf /var/lib/apt/lists/*

# Python dependencies.
COPY cli/requirements.txt /app/requirements.txt
RUN pip install --upgrade pip \
    && pip install -r /app/requirements.txt

# Backend source (xarchiver package, gallery-dl.conf, entrypoint).
COPY cli/ /app/

# Database migrations (settings.sql_dir defaults to /app/sql).
COPY sql/ /app/sql/

# Built WebUI from stage 1.
COPY --from=webui-builder /webui/dist /app/webui

RUN chmod +x /app/docker-entrypoint.sh

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD curl -fsS "http://127.0.0.1:8000/health" || exit 1

ENTRYPOINT ["/app/docker-entrypoint.sh"]
