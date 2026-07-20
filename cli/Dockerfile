# syntax=docker/dockerfile:1.7

FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /app

COPY requirements-ffmpeg.txt /app/requirements-ffmpeg.txt
RUN --mount=type=cache,target=/root/.cache/pip,sharing=locked \
    python -m pip install -r /app/requirements-ffmpeg.txt \
    && ln -s "$(python -c 'import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())')" \
        /usr/local/bin/ffmpeg

COPY requirements.txt /app/requirements.txt
COPY requirements-dev.txt /app/requirements-dev.txt

RUN --mount=type=cache,target=/root/.cache/pip,sharing=locked \
    python -m pip install -r /app/requirements-dev.txt

COPY . /app

ENTRYPOINT ["python", "-m", "xarchiver.cli"]

