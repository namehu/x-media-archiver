from __future__ import annotations

import hashlib
import shutil
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import orjson
from psycopg.types.json import Jsonb

from xarchiver.archive import normalize_path
from xarchiver.db import connect


MEDIA_EXTENSIONS = {".jpg", ".jpeg", ".png", ".gif", ".webp", ".mp4", ".mov", ".m4v"}
VIDEO_EXTENSIONS = {".mp4", ".mov", ".m4v"}


@dataclass(frozen=True)
class MediaAsset:
    tweet_id: str
    author_username: str | None
    author_display_name: str | None
    tweet_text: str | None
    published_at: str | None
    media_index: int | None
    media_type: str | None
    local_path: Path
    original_filename: str
    file_ext: str
    file_size: int
    sha256: str
    width: int | None
    height: int | None
    duration_ms: int | None
    source_engine: str
    metadata_path: Path
    raw_metadata: dict[str, Any]


def backfill_media_assets(archive_dir: Path, normalize_files: bool = True) -> dict[str, int]:
    media_dir = archive_dir / "media"
    if not media_dir.exists():
        return {"scanned": 0, "upserted": 0, "skipped": 0}

    assets: list[MediaAsset] = []
    skipped = 0
    for metadata_path in iter_metadata_paths(media_dir):
        asset = asset_from_metadata(media_dir, metadata_path, normalize_files)
        if asset is None:
            skipped += 1
            continue
        assets.append(asset)

    upsert_media_assets(assets)
    update_tweets_from_assets(assets)
    mark_tweets_with_assets_downloaded([asset.tweet_id for asset in assets])
    return {"scanned": len(assets) + skipped, "upserted": len(assets), "skipped": skipped}


def iter_metadata_paths(media_dir: Path) -> list[Path]:
    return sorted(path for path in media_dir.rglob("*.json") if path.is_file())


def asset_from_metadata(media_dir: Path, metadata_path: Path, normalize_files: bool) -> MediaAsset | None:
    try:
        metadata = orjson.loads(metadata_path.read_bytes())
    except orjson.JSONDecodeError:
        return None

    if metadata_path.name.endswith(".info.json"):
        return asset_from_yt_dlp_metadata(media_dir, metadata_path, metadata, normalize_files)
    return asset_from_gallery_dl_metadata(metadata_path, metadata)


def asset_from_gallery_dl_metadata(metadata_path: Path, metadata: dict[str, Any]) -> MediaAsset | None:
    media_path = Path(str(metadata_path)[: -len(".json")])
    if not media_path.exists() or media_path.suffix.lower() not in MEDIA_EXTENSIONS:
        return None

    tweet_id = value_as_str(metadata.get("tweet_id"))
    if not tweet_id:
        return None

    media_type = value_as_str(metadata.get("type")) or infer_media_type(media_path)
    media_index = value_as_int(metadata.get("num"))
    width = value_as_int(metadata.get("width"))
    height = value_as_int(metadata.get("height"))
    author = metadata.get("author") if isinstance(metadata.get("author"), dict) else {}

    return build_asset(
        tweet_id=tweet_id,
        author_username=value_as_str(author.get("name")),
        author_display_name=value_as_str(author.get("nick")),
        tweet_text=value_as_str(metadata.get("content")) or value_as_str(metadata.get("description")),
        published_at=parse_gallery_dl_datetime(metadata.get("date")),
        media_index=media_index,
        media_type=media_type,
        local_path=media_path,
        original_filename=media_path.name,
        width=width,
        height=height,
        duration_ms=None,
        source_engine="gallery-dl",
        metadata_path=metadata_path,
        raw_metadata=metadata,
    )


def asset_from_yt_dlp_metadata(
    media_dir: Path,
    metadata_path: Path,
    metadata: dict[str, Any],
    normalize_files: bool,
) -> MediaAsset | None:
    source_media_path = find_yt_dlp_media_file(metadata_path)
    if source_media_path is None:
        return None

    tweet_id = (
        value_as_str(metadata.get("display_id"))
        or value_as_str(metadata.get("webpage_url_basename"))
        or tweet_id_from_url(value_as_str(metadata.get("webpage_url")))
    )
    if not tweet_id:
        return None

    media_index = 1
    media_type = value_as_str(metadata.get("_type")) or infer_media_type(source_media_path)
    author = value_as_str(metadata.get("uploader_id")) or source_media_path.parent.parent.name

    local_path = source_media_path
    normalized_metadata_path = metadata_path
    if normalize_files:
        local_path, normalized_metadata_path = normalize_yt_dlp_files(
            media_dir=media_dir,
            source_media_path=source_media_path,
            source_metadata_path=metadata_path,
            author=author,
            tweet_id=tweet_id,
            media_index=media_index,
        )

    return build_asset(
        tweet_id=tweet_id,
        author_username=author,
        author_display_name=value_as_str(metadata.get("uploader")),
        tweet_text=value_as_str(metadata.get("description")) or value_as_str(metadata.get("title")),
        published_at=parse_yt_dlp_datetime(metadata),
        media_index=media_index,
        media_type=media_type,
        local_path=local_path,
        original_filename=source_media_path.name,
        width=value_as_int(metadata.get("width")),
        height=value_as_int(metadata.get("height")),
        duration_ms=duration_ms(metadata.get("duration")),
        source_engine="yt-dlp",
        metadata_path=normalized_metadata_path,
        raw_metadata=metadata,
    )


def find_yt_dlp_media_file(metadata_path: Path) -> Path | None:
    base_name = metadata_path.name[: -len(".info.json")]
    candidates = [
        path
        for path in metadata_path.parent.glob(f"{base_name}.*")
        if path.is_file() and path.suffix.lower() in MEDIA_EXTENSIONS and not path.name.endswith(".info.json")
    ]
    video_candidates = [path for path in candidates if path.suffix.lower() in VIDEO_EXTENSIONS]
    return sorted(video_candidates or candidates)[0] if candidates else None


def normalize_yt_dlp_files(
    media_dir: Path,
    source_media_path: Path,
    source_metadata_path: Path,
    author: str,
    tweet_id: str,
    media_index: int,
) -> tuple[Path, Path]:
    target_dir = media_dir / author / tweet_id
    target_dir.mkdir(parents=True, exist_ok=True)

    stem = f"{tweet_id}--m{media_index}"
    target_media_path = target_dir / f"{stem}{source_media_path.suffix.lower()}"
    target_metadata_path = target_dir / f"{stem}.info.json"

    move_if_needed(source_media_path, target_media_path)
    move_if_needed(source_metadata_path, target_metadata_path)

    thumbnail = source_metadata_path.parent / f"{source_media_path.stem}.jpg"
    if thumbnail.exists():
        move_if_needed(thumbnail, target_dir / f"{stem}.thumb.jpg")

    return target_media_path, target_metadata_path


def move_if_needed(source: Path, target: Path) -> None:
    if source == target:
        return
    if target.exists():
        return
    shutil.move(str(source), str(target))


def build_asset(
    tweet_id: str,
    author_username: str | None,
    author_display_name: str | None,
    tweet_text: str | None,
    published_at: str | None,
    media_index: int | None,
    media_type: str | None,
    local_path: Path,
    original_filename: str,
    width: int | None,
    height: int | None,
    duration_ms: int | None,
    source_engine: str,
    metadata_path: Path,
    raw_metadata: dict[str, Any],
) -> MediaAsset:
    return MediaAsset(
        tweet_id=tweet_id,
        author_username=author_username,
        author_display_name=author_display_name,
        tweet_text=tweet_text,
        published_at=published_at,
        media_index=media_index,
        media_type=media_type,
        local_path=local_path,
        original_filename=original_filename,
        file_ext=local_path.suffix.lower().lstrip("."),
        file_size=local_path.stat().st_size,
        sha256=sha256_file(local_path),
        width=width,
        height=height,
        duration_ms=duration_ms,
        source_engine=source_engine,
        metadata_path=metadata_path,
        raw_metadata=raw_metadata,
    )


def upsert_media_assets(assets: list[MediaAsset]) -> None:
    if not assets:
        return
    with connect() as conn:
        with conn.cursor() as cur:
            for asset in assets:
                cur.execute(
                    """
                    insert into media_assets (
                        tweet_id,
                        media_index,
                        media_type,
                        local_path,
                        original_filename,
                        file_ext,
                        file_size,
                        sha256,
                        width,
                        height,
                        duration_ms,
                        source_engine,
                        metadata_path,
                        download_status,
                        raw_metadata,
                        updated_at
                    )
                    values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'downloaded', %s, now())
                    on conflict (tweet_id, media_index, source_engine)
                    where media_index is not null and source_engine is not null
                    do update set
                        media_type = excluded.media_type,
                        local_path = excluded.local_path,
                        original_filename = excluded.original_filename,
                        file_ext = excluded.file_ext,
                        file_size = excluded.file_size,
                        sha256 = excluded.sha256,
                        width = excluded.width,
                        height = excluded.height,
                        duration_ms = excluded.duration_ms,
                        metadata_path = excluded.metadata_path,
                        download_status = case
                            when media_assets.download_status = 'verified' then 'verified'
                            else 'downloaded'
                        end,
                        error_message = null,
                        raw_metadata = excluded.raw_metadata,
                        updated_at = now()
                    """,
                    (
                        asset.tweet_id,
                        asset.media_index,
                        asset.media_type,
                        normalize_path(asset.local_path),
                        asset.original_filename,
                        asset.file_ext,
                        asset.file_size,
                        asset.sha256,
                        asset.width,
                        asset.height,
                        asset.duration_ms,
                        asset.source_engine,
                        normalize_path(asset.metadata_path),
                        Jsonb(asset.raw_metadata),
                    ),
                )
        conn.commit()


def update_tweets_from_assets(assets: list[MediaAsset]) -> None:
    if not assets:
        return
    with connect() as conn:
        with conn.cursor() as cur:
            for asset in assets:
                cur.execute(
                    """
                    update tweets
                    set author_username = coalesce(author_username, %s),
                        author_display_name = coalesce(author_display_name, %s),
                        text = coalesce(text, %s),
                        published_at = coalesce(published_at, %s),
                        updated_at = now()
                    where tweet_id = %s
                    """,
                    (
                        asset.author_username,
                        asset.author_display_name,
                        asset.tweet_text,
                        asset.published_at,
                        asset.tweet_id,
                    ),
                )
        conn.commit()


def mark_tweets_with_assets_downloaded(tweet_ids: list[str]) -> None:
    if not tweet_ids:
        return
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                update tweets
                set download_status = 'downloaded',
                    last_error = null,
                    updated_at = now()
                where tweet_id = any(%s)
                  and download_status in ('pending', 'downloading', 'failed_retryable', 'missing', 'corrupt', 'partial')
                """,
                (list(set(tweet_ids)),),
            )
        conn.commit()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def duration_ms(value: object) -> int | None:
    if value is None:
        return None
    try:
        return int(float(value) * 1000)
    except (TypeError, ValueError):
        return None


def value_as_int(value: object) -> int | None:
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def value_as_str(value: object) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def parse_gallery_dl_datetime(value: object) -> str | None:
    text = value_as_str(value)
    if not text:
        return None
    try:
        parsed = datetime.strptime(text, "%Y-%m-%d %H:%M:%S").replace(tzinfo=UTC)
    except ValueError:
        return text
    return parsed.isoformat()


def parse_yt_dlp_datetime(metadata: dict[str, Any]) -> str | None:
    timestamp = metadata.get("timestamp")
    if timestamp is not None:
        try:
            return datetime.fromtimestamp(float(timestamp), tz=UTC).isoformat()
        except (TypeError, ValueError, OSError):
            pass

    upload_date = value_as_str(metadata.get("upload_date"))
    if upload_date and len(upload_date) == 8 and upload_date.isdigit():
        try:
            return datetime.strptime(upload_date, "%Y%m%d").replace(tzinfo=UTC).isoformat()
        except ValueError:
            return None
    return None


def tweet_id_from_url(url: str | None) -> str | None:
    if not url:
        return None
    parts = [part for part in url.rstrip("/").split("/") if part]
    for index, part in enumerate(parts):
        if part == "status" and index + 1 < len(parts):
            return parts[index + 1].split("?")[0]
    return None


def infer_media_type(path: Path) -> str:
    if path.suffix.lower() in VIDEO_EXTENSIONS:
        return "video"
    return "photo"
