from __future__ import annotations

import csv
import os
from datetime import UTC, datetime
from html import escape
from pathlib import Path
from urllib.parse import quote

from xarchiver.archive import ensure_archive_dirs
from xarchiver.db import connect


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


def export_media_csv(
    archive_dir: Path,
    output_path: Path | None = None,
    status: str | None = "verified",
) -> dict[str, object]:
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
    timestamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    return archive_dir / "exports" / f"media-{timestamp}.csv"


def export_media_gallery(
    archive_dir: Path,
    output_path: Path | None = None,
    status: str | None = "verified",
) -> dict[str, object]:
    ensure_archive_dirs(archive_dir)
    target_path = output_path or default_gallery_export_path(archive_dir)
    target_path.parent.mkdir(parents=True, exist_ok=True)

    rows = fetch_export_rows(status)
    html = render_gallery_html(rows, archive_dir, target_path, status)
    target_path.write_text(html, encoding="utf-8")

    return {"path": target_path.as_posix(), "rows": len(rows), "status": status or "all"}


def default_gallery_export_path(archive_dir: Path) -> Path:
    timestamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    return archive_dir / "exports" / f"gallery-{timestamp}.html"


def export_failures_csv(archive_dir: Path, output_path: Path | None = None) -> dict[str, object]:
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
    timestamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    return archive_dir / "exports" / f"failures-{timestamp}.csv"


def export_duplicates_csv(archive_dir: Path, output_path: Path | None = None) -> dict[str, object]:
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
    timestamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    return archive_dir / "exports" / f"duplicates-{timestamp}.csv"


def fetch_export_rows(status: str | None) -> list[dict[str, object]]:
    sql = """
        select
            t.tweet_id,
            t.url as tweet_url,
            t.author_username,
            t.author_display_name,
            t.published_at,
            t.text as tweet_text,
            t.download_status as tweet_status,
            m.media_index,
            m.media_type,
            m.download_status as media_status,
            m.source_engine,
            m.local_path,
            m.metadata_path,
            m.original_filename,
            m.file_ext,
            m.file_size,
            m.sha256,
            m.width,
            m.height,
            m.duration_ms
        from media_assets m
        join tweets t on t.tweet_id = m.tweet_id
    """
    params: tuple[str, ...] = ()
    if status:
        sql += " where m.download_status = %s"
        params = (status,)
    sql += " order by t.author_username nulls last, t.tweet_id, m.media_index nulls last, m.id"

    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            return list(cur.fetchall())


def fetch_failure_rows(limit: int | None = None, offset: int = 0) -> list[dict[str, object]]:
    sql = """
        select
            t.tweet_id,
            t.url as tweet_url,
            t.author_username,
            t.download_status as tweet_status,
            t.last_error,
            t.retry_count,
            latest.engine as latest_engine,
            latest.status as latest_attempt_status,
            latest.error_category as latest_error_category,
            latest.error_message as latest_error_message,
            latest.exit_code as latest_exit_code,
            latest.finished_at as latest_finished_at
        from tweets t
        left join lateral (
            select engine, status, error_category, error_message, exit_code, finished_at
            from download_attempts da
            where da.tweet_id = t.tweet_id
            order by da.finished_at desc nulls last, da.id desc
            limit 1
        ) latest on true
        where t.download_status not in ('downloaded', 'verified', 'skipped')
        order by t.updated_at desc, t.tweet_id
    """
    params: list[object] = []
    if limit is not None:
        sql += " limit %s offset %s"
        params.extend([limit, offset])
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, tuple(params))
            return list(cur.fetchall())


def count_failure_rows() -> int:
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                select count(*)::int as count
                from tweets
                where download_status not in ('downloaded', 'verified', 'skipped')
                """
            )
            return int(cur.fetchone()["count"])


def fetch_duplicate_rows() -> list[dict[str, object]]:
    sql = """
        with duplicate_hashes as (
            select sha256,
                   count(*) as duplicate_count,
                   sum(coalesce(file_size, 0)) as total_size
            from media_assets
            where sha256 is not null
              and download_status in ('downloaded', 'verified')
            group by sha256
            having count(*) > 1
        )
        select
            d.sha256,
            d.duplicate_count,
            d.total_size,
            t.tweet_id,
            t.url as tweet_url,
            t.author_username,
            m.media_type,
            m.download_status as media_status,
            m.local_path,
            m.file_size
        from duplicate_hashes d
        join media_assets m on m.sha256 = d.sha256
        join tweets t on t.tweet_id = m.tweet_id
        order by d.duplicate_count desc, d.sha256, t.tweet_id, m.media_index nulls last, m.id
    """
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(sql)
            return list(cur.fetchall())


def count_duplicate_groups(rows: list[dict[str, object]]) -> int:
    return len({row.get("sha256") for row in rows if row.get("sha256")})


def normalize_csv_value(value: object) -> object:
    if value is None:
        return ""
    if isinstance(value, datetime):
        return value.isoformat()
    return value


def format_export_row(row: dict[str, object], archive_dir: Path) -> dict[str, object]:
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
    relative_path = relative_archive_path(value, archive_dir)
    if not relative_path:
        return ""
    media_path = archive_dir / relative_path
    href = Path(os.path.relpath(media_path, target_path.parent)).as_posix()
    return quote(href, safe="/:")


def html_text(value: object) -> str:
    if value is None:
        return ""
    if isinstance(value, datetime):
        value = value.isoformat()
    return escape(str(value))


def html_attr(value: object) -> str:
    return escape(str(value or ""), quote=True)


def relative_archive_path(value: object, archive_dir: Path) -> str:
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
