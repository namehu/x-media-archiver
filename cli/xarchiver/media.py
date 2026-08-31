"""媒体回填、规范化与预览图生成辅助函数。"""

from __future__ import annotations

import hashlib
import io
import logging
import os
import shutil
import subprocess
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import orjson
from PIL import Image, ImageCms, ImageOps, UnidentifiedImageError
from psycopg.types.json import Jsonb

from xarchiver.archive import normalize_path
from xarchiver.db import connect
from xarchiver.row_models import IdRow

MEDIA_EXTENSIONS = {".jpg", ".jpeg", ".png", ".gif", ".webp", ".mp4", ".mov", ".m4v"}
VIDEO_EXTENSIONS = {".mp4", ".mov", ".m4v"}
VIDEO_PREVIEW_SUFFIX = ".preview.jpg"
IMAGE_PREVIEW_SUFFIX = ".preview.webp"
VIDEO_THUMBNAIL_SUFFIX = ".thumb.jpg"
VIDEO_PREVIEW_MAX_WIDTH = 640
VIDEO_PREVIEW_TIMEOUT_SECONDS = 30
IMAGE_PREVIEW_MAX_EDGE = 640
IMAGE_PREVIEW_QUALITY = 82
SOURCE_ENGINE_PRIORITY = {"gallery-dl": 0, "yt-dlp": 1}

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class MediaAsset:
    """从磁盘与元数据解析出的标准媒体资产对象。"""

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


def backfill_media_assets(
    archive_dir: Path,
    normalize_files: bool = True,
    tweet_ids: list[str] | None = None,
) -> dict[str, object]:
    """扫描归档目录中的媒体元数据并回填 media_assets 表。"""

    media_dir = archive_dir / "media"
    if not media_dir.exists():
        return {
            "scanned": 0,
            "upserted": 0,
            "skipped": 0,
            "media_ids": [],
            "tweet_ids": [],
            "media_ids_by_engine": {},
            "tweet_ids_by_engine": {},
            "preview_generated": 0,
            "preview_existing": 0,
            "preview_failed": 0,
        }

    discovered_assets: list[MediaAsset] = []
    skipped = 0
    for metadata_path in iter_metadata_paths(media_dir, tweet_ids):
        asset = asset_from_metadata(media_dir, metadata_path, normalize_files)
        if asset is None:
            skipped += 1
            continue
        discovered_assets.append(asset)

    assets = select_preferred_assets(discovered_assets)
    media_ids = upsert_media_assets(assets)
    update_tweets_from_assets(assets)
    mark_tweets_with_assets_downloaded([asset.tweet_id for asset in assets])
    media_ids_by_engine: dict[str, list[int]] = {}
    tweet_ids_by_engine: dict[str, list[str]] = {}
    for asset in discovered_assets:
        engine_tweet_ids = tweet_ids_by_engine.setdefault(asset.source_engine, [])
        if asset.tweet_id not in engine_tweet_ids:
            engine_tweet_ids.append(asset.tweet_id)
    for asset, media_id in zip(assets, media_ids, strict=True):
        media_ids_by_engine.setdefault(asset.source_engine, []).append(media_id)
    return {
        "scanned": len(discovered_assets) + skipped,
        "upserted": len(assets),
        "skipped": skipped + len(discovered_assets) - len(assets),
        "media_ids": media_ids,
        "tweet_ids": list(dict.fromkeys(asset.tweet_id for asset in assets)),
        "media_ids_by_engine": media_ids_by_engine,
        "tweet_ids_by_engine": tweet_ids_by_engine,
        # 预览图由独立持久任务生成；下载与媒体回填链路不投递、也不生成。
        "preview_generated": 0,
        "preview_existing": 0,
        "preview_failed": 0,
    }


def select_preferred_assets(assets: list[MediaAsset]) -> list[MediaAsset]:
    """同一 Tweet 媒体位置只保留一个可用引擎产物，优先 gallery-dl。"""

    selected: dict[tuple[str, int], MediaAsset] = {}
    unindexed: list[MediaAsset] = []
    for asset in assets:
        if asset.media_index is None:
            unindexed.append(asset)
            continue
        key = (asset.tweet_id, asset.media_index)
        current = selected.get(key)
        if current is None or source_engine_priority(asset.source_engine) < source_engine_priority(
            current.source_engine
        ):
            selected[key] = asset
    return sorted(
        [*selected.values(), *unindexed],
        key=lambda asset: (
            asset.tweet_id,
            asset.media_index is None,
            asset.media_index or 0,
            source_engine_priority(asset.source_engine),
            asset.local_path.as_posix(),
        ),
    )


def source_engine_priority(source_engine: str) -> int:
    """返回媒体引擎的稳定优先级；未知引擎排在已知 fallback 之后。"""

    return SOURCE_ENGINE_PRIORITY.get(source_engine, len(SOURCE_ENGINE_PRIORITY))


def ensure_video_previews(assets: list[MediaAsset]) -> dict[str, int]:
    """为视频媒体批量补齐预览图。"""

    result = {
        "preview_generated": 0,
        "preview_existing": 0,
        "preview_failed": 0,
    }
    for asset in assets:
        if asset.media_type != "video" and asset.local_path.suffix.lower() not in VIDEO_EXTENSIONS:
            continue
        status = ensure_video_preview(asset.local_path)
        result[f"preview_{status}"] += 1
    return result


def ensure_video_preview(media_path: Path) -> str:
    """为单个视频生成或复用预览图。"""

    preview_path = video_preview_path(media_path)
    thumbnail_path = media_path.with_name(f"{media_path.stem}{VIDEO_THUMBNAIL_SUFFIX}")
    source_path = thumbnail_path if thumbnail_path.exists() else media_path
    if preview_path.exists() and preview_path.stat().st_mtime_ns >= source_path.stat().st_mtime_ns:
        return "existing"

    try:
        temp_path = build_video_preview_temp(media_path, preview_path)
        os.replace(temp_path, preview_path)
        return "generated"
    except (OSError, subprocess.SubprocessError, RuntimeError):
        logger.warning("Video preview generation failed for %s", media_path, exc_info=True)
        return "failed"


def video_preview_path(media_path: Path) -> Path:
    """返回视频预览图路径。"""

    return media_path.with_name(f"{media_path.stem}{VIDEO_PREVIEW_SUFFIX}")


def image_preview_path(media_path: Path) -> Path:
    """返回图片 WebP 预览图路径。"""

    return media_path.with_name(f"{media_path.stem}{IMAGE_PREVIEW_SUFFIX}")


def preview_path_for_media(media_path: Path, media_type: str) -> Path:
    """按媒体类型返回派生预览图路径。"""

    return video_preview_path(media_path) if media_type == "video" else image_preview_path(media_path)


def preview_freshness_source(media_path: Path, media_type: str) -> Path:
    """返回用于判断预览新旧的源文件；视频优先复用下载器缩略图。"""

    if media_type == "video":
        thumbnail_path = media_path.with_name(f"{media_path.stem}{VIDEO_THUMBNAIL_SUFFIX}")
        if thumbnail_path.is_file():
            return thumbnail_path
    return media_path


def preview_is_current(media_path: Path, preview_path: Path, media_type: str) -> bool:
    """检查预览是否存在、可解码且不早于源文件。"""

    source_path = preview_freshness_source(media_path, media_type)
    try:
        if preview_path.stat().st_size <= 0:
            return False
        if preview_path.stat().st_mtime_ns < source_path.stat().st_mtime_ns:
            return False
        with Image.open(preview_path) as preview:
            preview.verify()
        return True
    except (OSError, UnidentifiedImageError, ValueError):
        return False


def build_image_preview_temp(media_path: Path, preview_path: Path) -> Path:
    """将图片首帧转换为 640px WebP，并返回同目录唯一临时文件。"""

    temp_path = preview_path.with_name(f".{preview_path.stem}.{uuid.uuid4().hex}.tmp.webp")
    try:
        with Image.open(media_path) as opened:
            opened.seek(0)
            transposed = ImageOps.exif_transpose(opened)
            transposed.load()
            rendered = _convert_image_to_srgb(transposed)
            rendered.thumbnail(
                (IMAGE_PREVIEW_MAX_EDGE, IMAGE_PREVIEW_MAX_EDGE),
                Image.Resampling.LANCZOS,
                reducing_gap=3.0,
            )
            rendered.save(
                temp_path,
                format="WEBP",
                quality=IMAGE_PREVIEW_QUALITY,
                method=6,
            )
        if temp_path.stat().st_size <= 0:
            raise RuntimeError("empty_image_preview")
        return temp_path
    except Exception:
        temp_path.unlink(missing_ok=True)
        raise


def build_video_preview_temp(media_path: Path, preview_path: Path) -> Path:
    """用 ffmpeg 生成视频 JPEG 预览，并返回同目录唯一临时文件。"""

    source_path = preview_freshness_source(media_path, "video")
    attempts = [None] if source_path != media_path else ["0.5", None]
    last_error = "video_preview_generation_failed"
    for seek in attempts:
        temp_path = preview_path.with_name(f".{preview_path.stem}.{uuid.uuid4().hex}.tmp.jpg")
        try:
            command = ["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y"]
            if seek is not None:
                command.extend(["-ss", seek])
            command.extend(
                [
                    "-i",
                    str(source_path),
                    "-frames:v",
                    "1",
                    "-vf",
                    f"scale=min({VIDEO_PREVIEW_MAX_WIDTH}\\,iw):-2",
                    "-q:v",
                    "4",
                    str(temp_path),
                ]
            )
            completed = subprocess.run(
                command,
                check=False,
                capture_output=True,
                timeout=VIDEO_PREVIEW_TIMEOUT_SECONDS,
            )
            if completed.returncode == 0 and temp_path.exists() and temp_path.stat().st_size > 0:
                return temp_path
            last_error = "video_preview_decode_failed"
        finally:
            if not temp_path.exists() or temp_path.stat().st_size <= 0:
                temp_path.unlink(missing_ok=True)
    raise RuntimeError(last_error)


def _convert_image_to_srgb(image: Image.Image) -> Image.Image:
    """保留 alpha 并尽量把嵌入色彩配置转换为 sRGB。"""

    has_alpha = "A" in image.getbands() or image.mode in {"LA", "PA"}
    rgba = image.convert("RGBA") if has_alpha else None
    color = rgba.convert("RGB") if rgba is not None else image.convert("RGB")
    icc_profile = image.info.get("icc_profile")
    if isinstance(icc_profile, bytes) and icc_profile:
        try:
            color = ImageCms.profileToProfile(
                color,
                ImageCms.ImageCmsProfile(io.BytesIO(icc_profile)),
                ImageCms.createProfile("sRGB"),
                outputMode="RGB",
            )
        except (ImageCms.PyCMSError, OSError, ValueError):
            logger.debug("Unable to convert embedded image profile to sRGB", exc_info=True)
    if rgba is not None:
        color.putalpha(rgba.getchannel("A"))
    return color


def iter_metadata_paths(media_dir: Path, tweet_ids: list[str] | None = None) -> list[Path]:
    """遍历指定 tweet 范围内的媒体元数据文件路径。"""

    if tweet_ids is not None:
        paths: set[Path] = set()
        for tweet_id in tweet_ids:
            paths.update(path for path in media_dir.glob(f"*/{tweet_id}/*.json") if path.is_file())
        return sorted(paths)
    return sorted(path for path in media_dir.rglob("*.json") if path.is_file())


def asset_from_metadata(media_dir: Path, metadata_path: Path, normalize_files: bool) -> MediaAsset | None:
    """按元数据类型分发到 gallery-dl 或 yt-dlp 解析逻辑。"""

    try:
        metadata = orjson.loads(metadata_path.read_bytes())
    except orjson.JSONDecodeError:
        return None

    if metadata_path.name.endswith(".info.json"):
        return asset_from_yt_dlp_metadata(media_dir, metadata_path, metadata, normalize_files)
    return asset_from_gallery_dl_metadata(metadata_path, metadata)


def asset_from_gallery_dl_metadata(metadata_path: Path, metadata: dict[str, Any]) -> MediaAsset | None:
    """从 gallery-dl 元数据构造媒体资产。"""

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
    """从 yt-dlp 元数据构造媒体资产，并按需归一化文件位置。"""

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
    author_storage_id = value_as_str(metadata.get("uploader_id")) or source_media_path.parent.parent.name

    local_path = source_media_path
    normalized_metadata_path = metadata_path
    if normalize_files:
        local_path, normalized_metadata_path = normalize_yt_dlp_files(
            media_dir=media_dir,
            source_media_path=source_media_path,
            source_metadata_path=metadata_path,
            author_storage_id=safe_path_segment(author_storage_id),
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
    """根据 `.info.json` 找到对应的媒体文件。"""

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
    author_storage_id: str,
    tweet_id: str,
    media_index: int,
) -> tuple[Path, Path]:
    """把 yt-dlp 产物移动到项目约定的作者/tweet 目录结构。"""

    target_dir = media_dir / author_storage_id / safe_path_segment(tweet_id)
    target_dir.mkdir(parents=True, exist_ok=True)

    stem = f"{safe_path_segment(tweet_id)}--p{media_index}"
    target_media_path = target_dir / f"{stem}{source_media_path.suffix.lower()}"
    target_metadata_path = target_dir / f"{stem}.info.json"

    move_if_needed(source_media_path, target_media_path)
    move_if_needed(source_metadata_path, target_metadata_path)

    thumbnail = source_metadata_path.parent / f"{source_media_path.stem}.jpg"
    if thumbnail.exists():
        move_if_needed(thumbnail, target_dir / f"{stem}.thumb.jpg")

    return target_media_path, target_metadata_path


def safe_path_segment(value: str | None) -> str:
    """把任意文本收敛成适合作为路径片段的安全名字。"""

    text = (value or "").strip()
    safe = "".join(char if char.isalnum() or char in {"_", "-"} else "_" for char in text)
    safe = safe.strip("._-")
    return safe or "_unknown"


def move_if_needed(source: Path, target: Path) -> None:
    """仅在目标不存在时移动文件。"""

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
    """把解析字段整理成标准 MediaAsset 对象。"""

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


def upsert_media_assets(assets: list[MediaAsset]) -> list[int]:
    """把媒体资产 upsert 到 media_assets 表。"""

    if not assets:
        return []
    media_ids: list[int] = []
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
                    on conflict (tweet_id, media_index)
                    where media_index is not null
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
                        source_engine = excluded.source_engine,
                        metadata_path = excluded.metadata_path,
                        download_status = case
                            when media_assets.download_status = 'verified'
                              and media_assets.sha256 = excluded.sha256 then 'verified'
                            else 'downloaded'
                        end,
                        error_message = null,
                        raw_metadata = excluded.raw_metadata,
                        updated_at = now()
                    returning id
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
                media_ids.append(IdRow.model_validate(dict(cur.fetchone())).id)
        conn.commit()
    return media_ids


def update_tweets_from_assets(assets: list[MediaAsset]) -> None:
    """用媒体元数据反向补齐 tweets 表中的作者与文本字段。"""

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
    """把已成功回填出媒体的 tweet 标记为 downloaded。"""

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
    """计算文件的 SHA256。"""

    digest = hashlib.sha256()
    with path.open("rb") as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def duration_ms(value: object) -> int | None:
    """把秒数或浮点时长转换成毫秒。"""

    if value is None:
        return None
    try:
        return int(float(value) * 1000)
    except (TypeError, ValueError):
        return None


def value_as_int(value: object) -> int | None:
    """尽量把值解析成整数。"""

    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def value_as_str(value: object) -> str | None:
    """尽量把值解析成非空字符串。"""

    if value is None:
        return None
    text = str(value).strip()
    return text or None


def parse_gallery_dl_datetime(value: object) -> str | None:
    """解析 gallery-dl 的日期时间文本。"""

    text = value_as_str(value)
    if not text:
        return None
    try:
        parsed = datetime.strptime(text, "%Y-%m-%d %H:%M:%S").replace(tzinfo=UTC)
    except ValueError:
        return text
    return parsed.isoformat()


def parse_yt_dlp_datetime(metadata: dict[str, Any]) -> str | None:
    """解析 yt-dlp 元数据中的时间字段。"""

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
    """从 URL 中提取 tweet_id，提取失败则返回空。"""

    if not url:
        return None
    parts = [part for part in url.rstrip("/").split("/") if part]
    for index, part in enumerate(parts):
        if part == "status" and index + 1 < len(parts):
            return parts[index + 1].split("?")[0]
    return None


def infer_media_type(path: Path) -> str:
    """根据文件扩展名推断媒体类型。"""

    if path.suffix.lower() in VIDEO_EXTENSIONS:
        return "video"
    return "photo"
