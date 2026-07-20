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

# imageio-ffmpeg ships one self-contained binary per supported platform.
# Exposing it on PATH keeps gallery-dl/yt-dlp integration unchanged while
# avoiding Debian ffmpeg's large shared-library dependency tree. Keep this in
# its own stable layer so routine Python dependency updates can reuse it.
COPY cli/requirements-ffmpeg.txt /app/requirements-ffmpeg.txt
RUN --mount=type=cache,target=/root/.cache/pip,sharing=locked \
    python -m pip install -r /app/requirements-ffmpeg.txt \
    && ln -s "$(python -c 'import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())')" \
        /usr/local/bin/ffmpeg

# Python application dependencies.
COPY cli/requirements.txt /app/requirements.txt
RUN --mount=type=cache,target=/root/.cache/pip,sharing=locked \
    python -m pip install -r /app/requirements.txt

# Backend source (xarchiver package, Alembic migrations, gallery-dl.conf, entrypoint).
COPY --chmod=755 cli/docker-entrypoint.sh /app/docker-entrypoint.sh
COPY cli/xarchiver/ /app/xarchiver/
COPY cli/gallery-dl.conf /app/gallery-dl.conf

# Built WebUI from stage 1.
COPY --from=webui-builder /webui/dist /app/webui

EXPOSE 18000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:18000/health', timeout=5).read()"]

ENTRYPOINT ["/app/docker-entrypoint.sh"]
