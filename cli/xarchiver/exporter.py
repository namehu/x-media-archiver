from __future__ import annotations

import csv
from datetime import UTC, datetime
from pathlib import Path

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
