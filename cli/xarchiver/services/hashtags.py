"""从 gallery-dl 落盘元数据维护平台 Hashtag 事实。"""

from __future__ import annotations

import logging
import unicodedata
from dataclasses import dataclass
from importlib.metadata import PackageNotFoundError, version
from pathlib import Path
from typing import Any

import orjson
from psycopg.types.json import Jsonb
from sqlalchemy import bindparam, func, insert, select, update
from sqlalchemy.dialects.postgresql import insert as postgresql_insert

from xarchiver.archive import normalize_path
from xarchiver.config import Settings
from xarchiver.db import connect
from xarchiver.row_models import (
    GalleryMetadataPathRow,
    IdRow,
    TweetHashtagOptionRow,
    TweetHashtagRow,
)
from xarchiver.services.operation_logs import (
    append_operation_log_entry,
    close_operation_log_stream,
    create_operation_log_stream,
    redact_sensitive_text,
)
from xarchiver.sql_builder import compile_query
from xarchiver.tables import (
    hashtag_backfill_runs,
    hashtags,
    media_assets,
    tweet_hashtags,
)

MAX_HASHTAGS_PER_TWEET = 100
MAX_HASHTAG_LENGTH = 512
DEFAULT_BACKFILL_BATCH_SIZE = 500
MAX_BACKFILL_BATCH_SIZE = 500
OBSERVATION_INSERT_CHUNK_SIZE = 500
TESTED_GALLERY_DL_VERSIONS = ("1.32.1",)

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class ObservedHashtag:
    """单条 gallery-dl 元数据中经过边界校验的平台 Hashtag。"""

    display_name: str
    normalized_name: str
    position: int


@dataclass(frozen=True)
class HashtagObservation:
    """准备写入 Tweet 关系的 Hashtag 观察事实。"""

    tweet_id: str
    display_name: str
    normalized_name: str
    position: int
    metadata_path: str


def gallery_dl_compatibility() -> dict[str, object]:
    """返回当前 gallery-dl 版本及非阻断契约验证状态。"""

    try:
        installed_version = version("gallery-dl")
    except PackageNotFoundError:
        installed_version = None
    if installed_version is None:
        status = "unavailable"
    elif installed_version in TESTED_GALLERY_DL_VERSIONS:
        status = "tested"
    else:
        status = "unverified"
    return {
        "installed_version": installed_version,
        "tested_versions": list(TESTED_GALLERY_DL_VERSIONS),
        "validation_status": status,
        "warning_code": None if status == "tested" else f"gallery_dl_{status}",
    }


def log_gallery_dl_compatibility() -> dict[str, object]:
    """记录未经验证或不可用的 gallery-dl 版本，但不阻断应用启动。"""

    result = gallery_dl_compatibility()
    if result["validation_status"] != "tested":
        logger.warning(
            "gallery-dl metadata contract is not verified for the installed version.",
            extra={"event": "gallery_dl.version.unverified", "details": result},
        )
    return result


def normalize_hashtag(value: object) -> tuple[str, str] | None:
    """规范化结构化 Hashtag；不尝试从普通正文推断。"""

    if not isinstance(value, str):
        return None
    display_name = value.strip()
    if display_name.startswith("#"):
        display_name = display_name[1:]
    if (
        not display_name
        or display_name.startswith("#")
        or len(display_name) > MAX_HASHTAG_LENGTH
        or any(character.isspace() for character in display_name)
        or any(unicodedata.category(character) == "Cc" for character in display_name)
    ):
        return None
    normalized_name = unicodedata.normalize("NFKC", display_name).casefold()
    if not normalized_name or len(normalized_name) > MAX_HASHTAG_LENGTH:
        return None
    return display_name, normalized_name


def extract_gallery_dl_hashtags(metadata: object) -> tuple[list[ObservedHashtag], int]:
    """只读取 gallery-dl 顶层 ``hashtags`` 数组，并返回非法项数量。"""

    if not isinstance(metadata, dict) or "hashtags" not in metadata:
        return [], 0
    raw_values = metadata.get("hashtags")
    if not isinstance(raw_values, list):
        return [], 1
    invalid_count = max(0, len(raw_values) - MAX_HASHTAGS_PER_TWEET)
    result: list[ObservedHashtag] = []
    seen: set[str] = set()
    for position, raw_value in enumerate(raw_values[:MAX_HASHTAGS_PER_TWEET]):
        normalized = normalize_hashtag(raw_value)
        if normalized is None:
            invalid_count += 1
            continue
        display_name, normalized_name = normalized
        if normalized_name in seen:
            continue
        seen.add(normalized_name)
        result.append(ObservedHashtag(display_name, normalized_name, position))
    return result, invalid_count


def sync_registered_gallery_hashtags(
    archive_dir: Path,
    *,
    tweet_ids: list[str],
    gallery_dl_version: str | None,
    batch_size: int = DEFAULT_BACKFILL_BATCH_SIZE,
) -> dict[str, int]:
    """为刚完成 gallery-dl 回填的 Tweet 非破坏性补充 Hashtag。"""

    normalized_ids = list(dict.fromkeys(str(value) for value in tweet_ids if str(value)))
    if not normalized_ids:
        return empty_scan_result()
    return _scan_registered_gallery_metadata(
        archive_dir,
        tweet_ids=normalized_ids,
        apply=True,
        gallery_dl_version=gallery_dl_version,
        batch_size=batch_size,
    )


def run_hashtag_backfill(
    settings: Settings,
    *,
    apply: bool = False,
    confirm_apply: bool = False,
    batch_size: int = DEFAULT_BACKFILL_BATCH_SIZE,
) -> dict[str, object]:
    """显式扫描已登记的 gallery-dl 元数据；默认只输出 dry-run 摘要。"""

    if apply and not confirm_apply:
        raise ValueError("hashtag_backfill_confirmation_required")
    if not 1 <= batch_size <= MAX_BACKFILL_BATCH_SIZE:
        raise ValueError("invalid_hashtag_backfill_batch_size")

    compatibility = gallery_dl_compatibility()
    installed_version = compatibility.get("installed_version")
    mode = "apply" if apply else "dry_run"
    run_id = _create_backfill_run(mode, str(installed_version) if installed_version else None)
    log_stream_id: int | None = None
    log_stream_closed = False
    try:
        log_stream_id = create_operation_log_stream(
            "hashtag_backfill",
            run_id,
            f"logs/hashtag-backfill/run-{run_id}.jsonl",
            {
                "mode": mode,
                "batch_size": batch_size,
                "gallery_dl_version": installed_version,
            },
        )
        _attach_backfill_log_stream(run_id, log_stream_id)
        append_operation_log_entry(
            log_stream_id,
            "info",
            "hashtag-backfill",
            "开始扫描已登记的 gallery-dl 元数据。",
            context={"mode": mode, "batch_size": batch_size},
        )
        counts = _scan_registered_gallery_metadata(
            settings.archive_dir,
            tweet_ids=None,
            apply=apply,
            gallery_dl_version=None,
            batch_size=batch_size,
            on_batch=lambda last_media_id: _update_backfill_checkpoint(run_id, last_media_id),
        )
        result: dict[str, object] = {
            "run_id": run_id,
            "log_stream_id": log_stream_id,
            "mode": mode,
            "status": "completed",
            "gallery_dl": compatibility,
            **counts,
        }
        append_operation_log_entry(
            log_stream_id,
            "info",
            "hashtag-backfill",
            "平台 Hashtag 元数据扫描完成。",
            context=counts,
        )
        close_operation_log_stream(log_stream_id)
        log_stream_closed = True
        _finish_backfill_run(run_id, "completed", result=result)
        return result
    except BaseException as exc:
        error_message = redact_sensitive_text(str(exc)) or type(exc).__name__
        try:
            _finish_backfill_run(run_id, "failed", error_message=error_message)
        except Exception:
            logger.exception("Unable to mark hashtag backfill run %s failed.", run_id)
        if log_stream_id is not None and not log_stream_closed:
            try:
                append_operation_log_entry(
                    log_stream_id,
                    "error",
                    "hashtag-backfill",
                    "平台 Hashtag 元数据扫描失败。",
                    context={"error": error_message},
                    exception=exc,
                )
            except Exception:
                logger.exception("Unable to append failure log for hashtag backfill run %s.", run_id)
        raise
    finally:
        if log_stream_id is not None and not log_stream_closed:
            try:
                close_operation_log_stream(log_stream_id)
            except Exception:
                logger.exception("Unable to close hashtag backfill log stream %s.", log_stream_id)


def fetch_tweet_hashtags(cursor: object, tweet_ids: list[str]) -> dict[str, list[str]]:
    """批量读取 Tweet 平台 Hashtag，避免帖子卡片出现 N+1 查询。"""

    result = {tweet_id: [] for tweet_id in tweet_ids}
    if not tweet_ids:
        return result
    statement = (
        select(tweet_hashtags.c.tweet_id, tweet_hashtags.c.display_name)
        .where(tweet_hashtags.c.tweet_id.in_(tweet_ids))
        .order_by(
            tweet_hashtags.c.tweet_id,
            tweet_hashtags.c.position,
            tweet_hashtags.c.hashtag_id,
        )
    )
    sql, params = compile_query(statement)
    cursor.execute(sql, params)  # type: ignore[attr-defined]
    for row in (TweetHashtagRow.model_validate(dict(value)) for value in cursor.fetchall()):  # type: ignore[attr-defined]
        result[row.tweet_id].append(row.display_name)
    return result


def list_hashtag_options(query: str | None = None, limit: int = 20) -> list[TweetHashtagOptionRow]:
    """返回有界的平台 Hashtag 联想项及关联 Tweet 数量。"""

    safe_limit = max(1, min(int(limit), 50))
    count = func.count(tweet_hashtags.c.tweet_id).label("tweet_count")
    statement = (
        select(hashtags.c.name, hashtags.c.normalized_name, count)
        .select_from(hashtags.join(tweet_hashtags, tweet_hashtags.c.hashtag_id == hashtags.c.id))
        .group_by(hashtags.c.id, hashtags.c.name, hashtags.c.normalized_name)
        .order_by(count.desc(), hashtags.c.normalized_name)
        .limit(bindparam("hashtag_option_limit", safe_limit))
    )
    normalized_query = normalize_hashtag_query(query)
    if normalized_query:
        statement = statement.where(
            hashtags.c.normalized_name.contains(normalized_query, autoescape=True)
        )
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(*compile_query(statement))
            return [TweetHashtagOptionRow.model_validate(dict(row)) for row in cur.fetchall()]


def normalize_hashtag_query(value: str | None) -> str:
    """规范化精确筛选或联想查询中的 Hashtag 文本。"""

    text = unicodedata.normalize("NFKC", str(value or "")).strip()
    if text.startswith("#"):
        text = text[1:]
    return text.casefold()


def empty_scan_result() -> dict[str, int]:
    """返回稳定的元数据扫描统计结构。"""

    return {
        "scanned_metadata_count": 0,
        "valid_metadata_count": 0,
        "missing_file_count": 0,
        "invalid_file_count": 0,
        "invalid_hashtag_count": 0,
        "observed_hashtag_count": 0,
        "candidate_relationship_count": 0,
        "existing_relationship_count": 0,
        "would_insert_relationship_count": 0,
        "inserted_relationship_count": 0,
        "last_media_id": 0,
    }


def _scan_registered_gallery_metadata(
    archive_dir: Path,
    *,
    tweet_ids: list[str] | None,
    apply: bool,
    gallery_dl_version: str | None,
    batch_size: int,
    on_batch: Any | None = None,
) -> dict[str, int]:
    counts = empty_scan_result()
    seen_candidates: set[tuple[str, str]] = set()
    last_media_id = 0
    while True:
        rows = _fetch_metadata_path_batch(last_media_id, batch_size, tweet_ids)
        if not rows:
            break
        batch_observations: list[HashtagObservation] = []
        for row in rows:
            counts["scanned_metadata_count"] += 1
            last_media_id = max(last_media_id, row.id)
            counts["last_media_id"] = last_media_id
            observation_result = _read_metadata_observations(archive_dir, row)
            if observation_result["status"] != "valid":
                counts[f"{observation_result['status']}_count"] += 1
                continue
            counts["valid_metadata_count"] += 1
            counts["invalid_hashtag_count"] += int(observation_result["invalid_hashtag_count"])
            observations = list(observation_result["observations"])
            counts["observed_hashtag_count"] += len(observations)
            for observation in observations:
                key = (observation.tweet_id, observation.normalized_name)
                if key in seen_candidates:
                    continue
                seen_candidates.add(key)
                batch_observations.append(observation)
        counts["candidate_relationship_count"] = len(seen_candidates)
        existing = _fetch_existing_relationship_keys(batch_observations)
        counts["existing_relationship_count"] += len(existing)
        pending = [
            observation
            for observation in batch_observations
            if (observation.tweet_id, observation.normalized_name) not in existing
        ]
        counts["would_insert_relationship_count"] += len(pending)
        if apply and pending:
            counts["inserted_relationship_count"] += _insert_observations(
                pending,
                gallery_dl_version=gallery_dl_version,
            )
        if on_batch is not None:
            on_batch(last_media_id)
    return counts


def _fetch_metadata_path_batch(
    after_media_id: int,
    batch_size: int,
    tweet_ids: list[str] | None,
) -> list[GalleryMetadataPathRow]:
    statement = (
        select(media_assets.c.id, media_assets.c.tweet_id, media_assets.c.metadata_path)
        .where(
            media_assets.c.id > bindparam("hashtag_after_media_id", after_media_id),
            media_assets.c.source_engine == bindparam("hashtag_source_engine", "gallery-dl"),
            media_assets.c.metadata_path.is_not(None),
        )
        .order_by(media_assets.c.id)
        .limit(bindparam("hashtag_batch_size", batch_size))
    )
    if tweet_ids is not None:
        statement = statement.where(media_assets.c.tweet_id.in_(tweet_ids))
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(*compile_query(statement))
            return [GalleryMetadataPathRow.model_validate(dict(row)) for row in cur.fetchall()]


def _read_metadata_observations(
    archive_dir: Path,
    row: GalleryMetadataPathRow,
) -> dict[str, object]:
    metadata_path = resolve_registered_metadata_path(archive_dir, row.metadata_path)
    if metadata_path is None or not metadata_path.exists():
        return {"status": "missing_file", "observations": [], "invalid_hashtag_count": 0}
    if metadata_path.name.endswith(".info.json"):
        return {"status": "invalid_file", "observations": [], "invalid_hashtag_count": 0}
    try:
        metadata = orjson.loads(metadata_path.read_bytes())
    except (OSError, orjson.JSONDecodeError):
        return {"status": "invalid_file", "observations": [], "invalid_hashtag_count": 0}
    if not isinstance(metadata, dict) or str(metadata.get("tweet_id") or "") != row.tweet_id:
        return {"status": "invalid_file", "observations": [], "invalid_hashtag_count": 0}
    values, invalid_count = extract_gallery_dl_hashtags(metadata)
    relative_path = archive_relative_metadata_path(archive_dir, metadata_path)
    observations = [
        HashtagObservation(
            tweet_id=row.tweet_id,
            display_name=value.display_name,
            normalized_name=value.normalized_name,
            position=value.position,
            metadata_path=relative_path,
        )
        for value in values
    ]
    return {
        "status": "valid",
        "observations": observations,
        "invalid_hashtag_count": invalid_count,
    }


def resolve_registered_metadata_path(archive_dir: Path, value: str) -> Path | None:
    """将登记路径安全解析到 ``archive/media`` 内，拒绝目录逃逸和符号链接。"""

    path_text = str(value).replace("\\", "/")
    archive_text = archive_dir.as_posix().rstrip("/")
    if path_text.startswith(f"{archive_text}/"):
        relative = path_text[len(archive_text) + 1 :]
    elif "/archive/" in path_text:
        relative = path_text.split("/archive/", 1)[1]
    else:
        relative = path_text
    candidate = archive_dir / Path(relative)
    if candidate.is_symlink():
        return None
    resolved = candidate.resolve()
    media_root = (archive_dir / "media").resolve()
    if media_root != resolved and media_root not in resolved.parents:
        return None
    if resolved.exists() and not resolved.is_file():
        return None
    return resolved


def archive_relative_metadata_path(archive_dir: Path, metadata_path: Path) -> str:
    """把已验证的元数据文件路径保存为 archive 相对路径。"""

    return normalize_path(metadata_path.resolve().relative_to(archive_dir.resolve()))


def _fetch_existing_relationship_keys(
    observations: list[HashtagObservation],
) -> set[tuple[str, str]]:
    if not observations:
        return set()
    tweet_ids = list({value.tweet_id for value in observations})
    normalized_names = list({value.normalized_name for value in observations})
    statement = (
        select(tweet_hashtags.c.tweet_id, hashtags.c.normalized_name)
        .select_from(tweet_hashtags.join(hashtags, hashtags.c.id == tweet_hashtags.c.hashtag_id))
        .where(
            tweet_hashtags.c.tweet_id.in_(tweet_ids),
            hashtags.c.normalized_name.in_(normalized_names),
        )
    )
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(*compile_query(statement))
            return {(str(row["tweet_id"]), str(row["normalized_name"])) for row in cur.fetchall()}


def _insert_observations(
    observations: list[HashtagObservation],
    *,
    gallery_dl_version: str | None,
) -> int:
    inserted_count = 0
    with connect() as conn:
        with conn.cursor() as cur:
            for start in range(0, len(observations), OBSERVATION_INSERT_CHUNK_SIZE):
                chunk = observations[start : start + OBSERVATION_INSERT_CHUNK_SIZE]
                catalog_values: dict[str, str] = {}
                for observation in chunk:
                    catalog_values.setdefault(
                        observation.normalized_name,
                        observation.display_name,
                    )
                catalog_insert = postgresql_insert(hashtags).values(
                    [
                        {"name": display_name, "normalized_name": normalized_name}
                        for normalized_name, display_name in catalog_values.items()
                    ]
                )
                catalog_insert = catalog_insert.on_conflict_do_nothing(
                    index_elements=[hashtags.c.normalized_name]
                )
                cur.execute(*compile_query(catalog_insert))

                catalog_statement = select(hashtags.c.id, hashtags.c.normalized_name).where(
                    hashtags.c.normalized_name.in_(list(catalog_values))
                )
                cur.execute(*compile_query(catalog_statement))
                ids = {str(row["normalized_name"]): int(row["id"]) for row in cur.fetchall()}
                relationship_insert = postgresql_insert(tweet_hashtags).values(
                    [
                        {
                            "tweet_id": observation.tweet_id,
                            "hashtag_id": ids[observation.normalized_name],
                            "display_name": observation.display_name,
                            "position": observation.position,
                            "source_engine": "gallery-dl",
                            "metadata_path": observation.metadata_path,
                            "gallery_dl_version": gallery_dl_version,
                        }
                        for observation in chunk
                    ]
                )
                relationship_insert = relationship_insert.on_conflict_do_nothing(
                    index_elements=[tweet_hashtags.c.tweet_id, tweet_hashtags.c.hashtag_id]
                ).returning(tweet_hashtags.c.tweet_id, tweet_hashtags.c.hashtag_id)
                cur.execute(*compile_query(relationship_insert))
                inserted_count += len(cur.fetchall())
        conn.commit()
    return inserted_count


def _create_backfill_run(mode: str, gallery_dl_version: str | None) -> int:
    statement = (
        insert(hashtag_backfill_runs)
        .values(mode=mode, status="running", gallery_dl_version=gallery_dl_version, last_media_id=0)
        .returning(hashtag_backfill_runs.c.id)
    )
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(*compile_query(statement))
            run_id = IdRow.model_validate(dict(cur.fetchone())).id
        conn.commit()
    return run_id


def _attach_backfill_log_stream(run_id: int, log_stream_id: int) -> None:
    statement = (
        update(hashtag_backfill_runs)
        .where(hashtag_backfill_runs.c.id == run_id)
        .values(log_stream_id=log_stream_id)
    )
    _execute_backfill_update(statement)


def _update_backfill_checkpoint(run_id: int, last_media_id: int) -> None:
    statement = (
        update(hashtag_backfill_runs)
        .where(hashtag_backfill_runs.c.id == run_id)
        .values(last_media_id=last_media_id)
    )
    _execute_backfill_update(statement)


def _finish_backfill_run(
    run_id: int,
    status: str,
    *,
    result: dict[str, object] | None = None,
    error_message: str | None = None,
) -> None:
    statement = (
        update(hashtag_backfill_runs)
        .where(hashtag_backfill_runs.c.id == run_id)
        .values(
            status=status,
            result=Jsonb(result) if result is not None else None,
            error_message=error_message,
            finished_at=func.now(),
        )
    )
    _execute_backfill_update(statement)


def _execute_backfill_update(statement: Any) -> None:
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(*compile_query(statement))
        conn.commit()
