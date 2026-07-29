"""导出 CSV 与 HTML 画廊的辅助函数。"""

from __future__ import annotations

import csv
import os
from datetime import UTC, datetime
from html import escape
from pathlib import Path
from urllib.parse import quote

from sqlalchemy import Integer, bindparam, case, func, lateral, select, true

from xarchiver.archive import ensure_archive_dirs
from xarchiver.db import connect
from xarchiver.row_models import DuplicateRow, ExportMediaRow, FailureRow
from xarchiver.sql_builder import compile_query
from xarchiver.tables import download_attempts, media_assets, tweets

CSV_FIELDS = [
    "tweet_id",
    "tweet_url",
    "author_username",
    "author_display_name",
    "published_at",
    "tweet_text",
    "tweet_status",
    "media_index",
    "media_type",
    "media_status",
    "source_engine",
    "local_path",
    "media_relative_path",
    "metadata_path",
    "metadata_relative_path",
    "original_filename",
    "file_ext",
    "file_size",
    "sha256",
    "width",
    "height",
    "duration_ms",
]

FAILURE_CSV_FIELDS = [
    "tweet_id",
    "tweet_url",
    "author_username",
    "tweet_status",
    "last_error",
    "retry_count",
    "latest_engine",
    "latest_attempt_status",
    "latest_error_category",
    "latest_error_message",
    "latest_exit_code",
    "latest_finished_at",
]

DUPLICATE_CSV_FIELDS = [
    "sha256",
    "duplicate_count",
    "total_size",
    "tweet_id",
    "tweet_url",
    "author_username",
    "media_type",
    "media_status",
    "local_path",
    "media_relative_path",
    "file_size",
]

IMAGE_EXTENSIONS = {"avif", "gif", "jpeg", "jpg", "png", "webp"}
VIDEO_EXTENSIONS = {"m4v", "mov", "mp4", "webm"}
FAILURE_TWEET_STATUSES = ("failed_retryable", "failed_permanent", "corrupt")


def export_media_csv(
    archive_dir: Path,
    output_path: Path | None = None,
    status: str | None = "verified",
) -> dict[str, object]:
    """导出媒体记录 CSV。"""

    ensure_archive_dirs(archive_dir)
    target_path = output_path or default_export_path(archive_dir)
    target_path.parent.mkdir(parents=True, exist_ok=True)

    rows = fetch_export_rows(status)
    with target_path.open("w", encoding="utf-8-sig", newline="") as file:
        writer = csv.DictWriter(file, fieldnames=CSV_FIELDS)
        writer.writeheader()
        for row in rows:
            writer.writerow(format_export_row(row, archive_dir))

    return {"path": target_path.as_posix(), "rows": len(rows), "status": status or "all"}


def default_export_path(archive_dir: Path) -> Path:
    """生成媒体 CSV 的默认导出路径。"""

    timestamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    return archive_dir / "exports" / f"media-{timestamp}.csv"


def export_media_gallery(
    archive_dir: Path,
    output_path: Path | None = None,
    status: str | None = "verified",
) -> dict[str, object]:
    """导出可本地打开的 HTML 媒体画廊。"""

    ensure_archive_dirs(archive_dir)
    target_path = output_path or default_gallery_export_path(archive_dir)
    target_path.parent.mkdir(parents=True, exist_ok=True)

    rows = fetch_export_rows(status)
    html = render_gallery_html(rows, archive_dir, target_path, status)
    target_path.write_text(html, encoding="utf-8")

    return {"path": target_path.as_posix(), "rows": len(rows), "status": status or "all"}


def default_gallery_export_path(archive_dir: Path) -> Path:
    """生成 HTML 画廊的默认导出路径。"""

    timestamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    return archive_dir / "exports" / f"gallery-{timestamp}.html"


def export_failures_csv(archive_dir: Path, output_path: Path | None = None) -> dict[str, object]:
    """导出失败记录 CSV。"""

    ensure_archive_dirs(archive_dir)
    target_path = output_path or default_failures_export_path(archive_dir)
    target_path.parent.mkdir(parents=True, exist_ok=True)

    rows = fetch_failure_rows()
    with target_path.open("w", encoding="utf-8-sig", newline="") as file:
        writer = csv.DictWriter(file, fieldnames=FAILURE_CSV_FIELDS)
        writer.writeheader()
        for row in rows:
            writer.writerow({field: normalize_csv_value(row.get(field)) for field in FAILURE_CSV_FIELDS})

    return {"path": target_path.as_posix(), "rows": len(rows)}


def default_failures_export_path(archive_dir: Path) -> Path:
    """生成失败记录 CSV 的默认导出路径。"""

    timestamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    return archive_dir / "exports" / f"failures-{timestamp}.csv"


def export_duplicates_csv(archive_dir: Path, output_path: Path | None = None) -> dict[str, object]:
    """导出重复媒体 CSV。"""

    ensure_archive_dirs(archive_dir)
    target_path = output_path or default_duplicates_export_path(archive_dir)
    target_path.parent.mkdir(parents=True, exist_ok=True)

    rows = fetch_duplicate_rows()
    with target_path.open("w", encoding="utf-8-sig", newline="") as file:
        writer = csv.DictWriter(file, fieldnames=DUPLICATE_CSV_FIELDS)
        writer.writeheader()
        for row in rows:
            values = {field: normalize_csv_value(row.get(field)) for field in DUPLICATE_CSV_FIELDS}
            values["media_relative_path"] = relative_archive_path(row.get("local_path"), archive_dir)
            writer.writerow(values)

    return {"path": target_path.as_posix(), "rows": len(rows), "duplicate_groups": count_duplicate_groups(rows)}


def default_duplicates_export_path(archive_dir: Path) -> Path:
    """生成重复媒体 CSV 的默认导出路径。"""

    timestamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    return archive_dir / "exports" / f"duplicates-{timestamp}.csv"


def fetch_export_rows(status: str | None) -> list[ExportMediaRow]:
    """读取导出媒体记录。"""

    sql, params = build_export_rows_query(status)

    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            return [ExportMediaRow.model_validate(dict(row)) for row in cur.fetchall()]


def build_export_rows_query(status: str | None) -> tuple[str, dict[str, object]]:
    """构造媒体导出查询。"""

    statement = (
        select(
            tweets.c.tweet_id,
            tweets.c.url.label("tweet_url"),
            tweets.c.author_username,
            tweets.c.author_display_name,
            tweets.c.published_at,
            tweets.c.text.label("tweet_text"),
            tweets.c.download_status.label("tweet_status"),
            media_assets.c.media_index,
            media_assets.c.media_type,
            media_assets.c.download_status.label("media_status"),
            media_assets.c.source_engine,
            media_assets.c.local_path,
            media_assets.c.metadata_path,
            media_assets.c.original_filename,
            media_assets.c.file_ext,
            media_assets.c.file_size,
            media_assets.c.sha256,
            media_assets.c.width,
            media_assets.c.height,
            media_assets.c.duration_ms,
        )
        .select_from(media_assets.join(tweets, tweets.c.tweet_id == media_assets.c.tweet_id))
        .order_by(
            tweets.c.author_username.asc().nulls_last(),
            tweets.c.tweet_id.asc(),
            media_assets.c.media_index.asc().nulls_last(),
            media_assets.c.id.asc(),
        )
    )
    if status:
        statement = statement.where(media_assets.c.download_status == bindparam("media_status", status))
    return compile_query(statement)


def fetch_failure_rows(limit: int | None = None, offset: int = 0) -> list[FailureRow]:
    """读取失败记录列表。"""

    sql, params = build_failure_rows_query(limit=limit, offset=offset)
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            return [FailureRow.model_validate(dict(row)) for row in cur.fetchall()]


def build_failure_rows_query(limit: int | None = None, offset: int = 0) -> tuple[str, dict[str, object]]:
    """构造失败记录查询。"""

    latest_attempt = lateral(
        select(
            download_attempts.c.engine,
            download_attempts.c.status,
            download_attempts.c.error_category,
            download_attempts.c.error_message,
            download_attempts.c.exit_code,
            download_attempts.c.finished_at,
        )
        .select_from(download_attempts)
        .where(download_attempts.c.tweet_id == tweets.c.tweet_id)
        .order_by(download_attempts.c.finished_at.desc().nulls_last(), download_attempts.c.id.desc())
        .limit(1)
    ).alias("latest")
    statement = (
        select(
            tweets.c.tweet_id,
            tweets.c.url.label("tweet_url"),
            tweets.c.author_username,
            tweets.c.download_status.label("tweet_status"),
            tweets.c.last_error,
            tweets.c.retry_count,
            latest_attempt.c.engine.label("latest_engine"),
            latest_attempt.c.status.label("latest_attempt_status"),
            latest_attempt.c.error_category.label("latest_error_category"),
            latest_attempt.c.error_message.label("latest_error_message"),
            latest_attempt.c.exit_code.label("latest_exit_code"),
            latest_attempt.c.finished_at.label("latest_finished_at"),
        )
        .select_from(tweets.outerjoin(latest_attempt, true()))
        .where(tweets.c.download_status.in_(FAILURE_TWEET_STATUSES))
        .order_by(tweets.c.updated_at.desc(), tweets.c.tweet_id.asc())
    )
    if limit is not None:
        statement = statement.limit(bindparam("limit", limit)).offset(bindparam("offset", offset))
    return compile_query(statement)


def count_failure_rows() -> int:
    """统计失败记录总数。"""

    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                select count(*)::int as count
                from tweets
                where download_status = any(%s)
                """,
                (list(FAILURE_TWEET_STATUSES),),
            )
            return int(cur.fetchone()["count"])


def fetch_duplicate_rows(limit: int | None = None, offset: int = 0) -> list[DuplicateRow]:
    """读取重复媒体明细行。"""

    sql, params = build_duplicate_rows_query(limit=limit, offset=offset)
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            return [DuplicateRow.model_validate(dict(row)) for row in cur.fetchall()]


def fetch_duplicate_group_rows(limit: int = 20, offset: int = 0) -> list[DuplicateRow]:
    """按分页范围读取重复媒体分组明细。"""

    sql, params = build_duplicate_group_rows_query(limit=limit, offset=offset)
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            return [DuplicateRow.model_validate(dict(row)) for row in cur.fetchall()]


def build_duplicate_rows_query(limit: int | None = None, offset: int = 0) -> tuple[str, dict[str, object]]:
    """构造重复媒体明细查询。"""

    duplicate_hashes = _duplicate_hashes_cte()
    statement = _duplicate_rows_statement(duplicate_hashes)
    if limit is not None:
        statement = statement.limit(bindparam("limit", limit)).offset(bindparam("offset", offset))
    return compile_query(statement)


def build_duplicate_group_rows_query(limit: int = 20, offset: int = 0) -> tuple[str, dict[str, object]]:
    """构造重复媒体分组分页查询。"""

    duplicate_hashes = _duplicate_hashes_cte()
    paged_duplicate_hashes = (
        select(
            duplicate_hashes.c.sha256,
            duplicate_hashes.c.duplicate_count,
            duplicate_hashes.c.total_size,
        )
        .order_by(duplicate_hashes.c.duplicate_count.desc(), duplicate_hashes.c.sha256.asc())
        .limit(bindparam("limit", limit))
        .offset(bindparam("offset", offset))
        .cte("paged_duplicate_hashes")
    )
    return compile_query(_duplicate_rows_statement(paged_duplicate_hashes))


def _duplicate_hashes_cte():
    """构造重复哈希分组 CTE。"""

    duplicate_count = func.count().label("duplicate_count")
    return (
        select(
            media_assets.c.sha256,
            duplicate_count,
            func.sum(func.coalesce(media_assets.c.file_size, 0)).label("total_size"),
        )
        .select_from(media_assets)
        .where(
            media_assets.c.sha256.is_not(None),
            media_assets.c.download_status.in_(("downloaded", "verified")),
        )
        .group_by(media_assets.c.sha256)
        .having(func.count() > 1)
        .cte("duplicate_hashes")
    )


def _duplicate_rows_statement(duplicate_hashes):
    """构造重复媒体公共明细查询主体。"""

    statement = (
        select(
            duplicate_hashes.c.sha256,
            duplicate_hashes.c.duplicate_count.cast(Integer).label("duplicate_count"),
            duplicate_hashes.c.total_size,
            media_assets.c.id,
            tweets.c.tweet_id,
            tweets.c.url.label("tweet_url"),
            tweets.c.author_username,
            media_assets.c.media_index,
            media_assets.c.media_type,
            media_assets.c.download_status.label("media_status"),
            media_assets.c.local_path,
            media_assets.c.file_size,
        )
        .select_from(
            duplicate_hashes.join(media_assets, media_assets.c.sha256 == duplicate_hashes.c.sha256).join(
                tweets,
                tweets.c.tweet_id == media_assets.c.tweet_id,
            )
        )
        .order_by(
            duplicate_hashes.c.duplicate_count.desc(),
            duplicate_hashes.c.sha256.asc(),
            case((media_assets.c.download_status == "verified", 0), else_=1).asc(),
            media_assets.c.id.asc(),
        )
    )
    return statement


def count_duplicate_rows() -> int:
    """统计重复媒体明细总行数。"""

    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                with duplicate_hashes as (
                    select sha256
                    from media_assets
                    where sha256 is not null
                      and download_status in ('downloaded', 'verified')
                    group by sha256
                    having count(*) > 1
                )
                select count(*)::int as count
                from media_assets m
                join duplicate_hashes d on d.sha256 = m.sha256
                """
            )
            return int(cur.fetchone()["count"])


def count_all_duplicate_groups() -> int:
    """统计全部重复哈希分组数量。"""

    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                select count(*)::int as count
                from (
                    select sha256
                    from media_assets
                    where sha256 is not null
                      and download_status in ('downloaded', 'verified')
                    group by sha256
                    having count(*) > 1
                ) duplicate_hashes
                """
            )
            return int(cur.fetchone()["count"])


def count_duplicate_groups(rows: list[dict[str, object]]) -> int:
    """统计结果集中的重复分组数。"""

    return len({row.get("sha256") for row in rows if row.get("sha256")})


def normalize_csv_value(value: object) -> object:
    """把导出值规范为适合写入 CSV 的形式。"""

    if value is None:
        return ""
    if isinstance(value, datetime):
        return value.isoformat()
    return value


def format_export_row(row: dict[str, object], archive_dir: Path) -> dict[str, object]:
    """把导出行补齐 archive 相对路径字段。"""

    values = {field: normalize_csv_value(row.get(field)) for field in CSV_FIELDS}
    values["media_relative_path"] = relative_archive_path(row.get("local_path"), archive_dir)
    values["metadata_relative_path"] = relative_archive_path(row.get("metadata_path"), archive_dir)
    return values


def render_gallery_html(
    rows: list[dict[str, object]],
    archive_dir: Path,
    target_path: Path,
    status: str | None,
) -> str:
    """渲染完整 HTML 画廊文档。"""

    cards = "\n".join(render_gallery_card(row, archive_dir, target_path) for row in rows)
    selection = html_text(status or "all")
    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>X Media Gallery</title>
  <style>
    :root {{ color-scheme: dark; font-family: system-ui, sans-serif; }}
    body {{ margin: 0; background: #101216; color: #f1f3f4; }}
    header {{ padding: 2rem clamp(1rem, 4vw, 3rem) 1rem; }}
    h1 {{ margin: 0 0 .5rem; font-size: clamp(1.6rem, 4vw, 2.25rem); }}
    header p {{ margin: 0; color: #aeb5c0; }}
    main {{ display: grid; grid-template-columns: repeat(auto-fill, minmax(270px, 1fr)); gap: 1rem; padding: 1rem clamp(1rem, 4vw, 3rem) 3rem; }}
    article {{ overflow: hidden; border: 1px solid #292e36; border-radius: .7rem; background: #181c22; }}
    .preview {{ display: block; width: 100%; height: 260px; object-fit: contain; background: #090b0d; }}
    .no-preview {{ display: grid; place-content: center; color: #87909e; }}
    .details {{ padding: .85rem 1rem 1rem; }}
    .author {{ color: #d6dcff; font-weight: 600; }}
    .text {{ white-space: pre-wrap; overflow-wrap: anywhere; margin: .65rem 0; color: #d6dae0; }}
    .meta {{ color: #98a1ae; font-size: .86rem; margin-bottom: .7rem; }}
    a {{ color: #91bbff; }}
    .links {{ display: flex; gap: 1rem; flex-wrap: wrap; }}
  </style>
</head>
<body>
  <header>
    <h1>X Media Gallery</h1>
    <p>{len(rows)} media item(s) &middot; status: {selection}</p>
  </header>
  <main>
{cards}
  </main>
</body>
</html>
"""


def render_gallery_card(row: dict[str, object], archive_dir: Path, target_path: Path) -> str:
    """渲染单个媒体卡片 HTML。"""

    media_href = gallery_media_href(row.get("local_path"), archive_dir, target_path)
    escaped_href = html_attr(media_href)
    media_type = str(row.get("media_type") or "").lower()
    file_ext = str(row.get("file_ext") or "").lower().lstrip(".")
    if media_href and (media_type in {"photo", "image"} or file_ext in IMAGE_EXTENSIONS):
        preview = (
            f'    <a href="{escaped_href}">'
            f'<img class="preview" src="{escaped_href}" loading="lazy" alt=""></a>'
        )
    elif media_href and (media_type == "video" or file_ext in VIDEO_EXTENSIONS):
        preview = (
            f'    <video class="preview" src="{escaped_href}" '
            'controls preload="metadata"></video>'
        )
    else:
        preview = '    <div class="preview no-preview">No preview available</div>'

    author = row.get("author_display_name") or row.get("author_username") or "Unknown author"
    username = row.get("author_username")
    author_label = html_text(author)
    if username and str(username) != str(author):
        author_label += f" (@{html_text(username)})"
    tweet_url = html_attr(row.get("tweet_url"))
    media_link = f'<a href="{escaped_href}">Open media</a>' if media_href else ""
    tweet_link = f'<a href="{tweet_url}">Open post</a>' if row.get("tweet_url") else ""
    links = " ".join(part for part in (media_link, tweet_link) if part)
    meta_parts = [
        row.get("published_at"),
        row.get("media_type"),
        row.get("media_status"),
    ]
    metadata = " | ".join(html_text(part) for part in meta_parts if part is not None)
    return f"""  <article>
{preview}
    <div class="details">
      <div class="author">{author_label}</div>
      <div class="text">{html_text(row.get("tweet_text"))}</div>
      <div class="meta">{metadata}</div>
      <div class="links">{links}</div>
    </div>
  </article>"""


def gallery_media_href(value: object, archive_dir: Path, target_path: Path) -> str:
    """把本地媒体路径转换成相对 HTML 文件可访问的 href。"""

    relative_path = relative_archive_path(value, archive_dir)
    if not relative_path:
        return ""
    media_path = archive_dir / relative_path
    href = Path(os.path.relpath(media_path, target_path.parent)).as_posix()
    return quote(href, safe="/:")


def html_text(value: object) -> str:
    """转义普通 HTML 文本。"""

    if value is None:
        return ""
    if isinstance(value, datetime):
        value = value.isoformat()
    return escape(str(value))


def html_attr(value: object) -> str:
    """转义 HTML 属性值。"""

    return escape(str(value or ""), quote=True)


def relative_archive_path(value: object, archive_dir: Path) -> str:
    """把存储路径规范成 archive 相对路径。"""

    if not value:
        return ""
    path_text = str(value)
    archive_text = archive_dir.as_posix().rstrip("/")
    if path_text.startswith(f"{archive_text}/"):
        return path_text[len(archive_text) + 1 :]
    marker = "/archive/"
    if marker in path_text:
        return path_text.split(marker, 1)[1]
    return path_text
