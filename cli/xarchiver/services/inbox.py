from __future__ import annotations

from datetime import UTC, datetime, timedelta
from hashlib import sha256
from pathlib import Path

from psycopg.types.json import Jsonb

from xarchiver.archive import ensure_archive_dirs, normalize_path
from xarchiver.config import Settings
from xarchiver.db import connect
from xarchiver.services.runs import run_archive_file


SUPPORTED_INBOX_SUFFIXES = {".txt": "urls", ".jsonl": "jsonl"}


def scan_inbox(settings: Settings) -> dict[str, object]:
    ensure_archive_dirs(settings.archive_dir)
    inbox_dir = settings.archive_dir / "inbox"
    discovered = 0
    known = 0
    unsupported = 0

    for path in sorted(inbox_dir.iterdir()):
        if not path.is_file():
            continue
        file_type = SUPPORTED_INBOX_SUFFIXES.get(path.suffix.lower())
        if not file_type:
            unsupported += 1
            continue
        if register_file(path, file_type):
            discovered += 1
        else:
            known += 1

    mark_scheduler_scan(settings, datetime.now(UTC))
    return {
        "inbox_dir": inbox_dir.as_posix(),
        "discovered": discovered,
        "known": known,
        "unsupported": unsupported,
    }


def register_file(path: Path, file_type: str) -> bool:
    file_hash = file_sha256(path)
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                insert into inbox_imports (file_path, filename, file_type, file_size, sha256)
                values (%s, %s, %s, %s, %s)
                on conflict (sha256) do nothing
                returning id
                """,
                (normalize_path(path), path.name, file_type, path.stat().st_size, file_hash),
            )
            inserted = cur.fetchone() is not None
        conn.commit()
    return inserted


def file_sha256(path: Path) -> str:
    digest = sha256()
    with path.open("rb") as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def list_inbox_imports(status: str | None = None, limit: int = 100) -> list[dict[str, object]]:
    sql = """
        select id, file_path, filename, file_type, file_size, sha256, status,
               discovered_at, processing_started_at, processed_at, error_message, result, archive_run_id
        from inbox_imports
    """
    params: list[object] = []
    if status:
        sql += " where status = %s"
        params.append(status)
    sql += " order by discovered_at desc, id desc limit %s"
    params.append(limit)
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, tuple(params))
            return list(cur.fetchall())


def process_inbox_import(
    import_id: int,
    settings: Settings,
    limit: int | None = None,
    trigger_type: str = "manual_inbox",
) -> dict[str, object]:
    row = claim_import(import_id)
    if row is None:
        raise ValueError("inbox_import_not_processable")

    path = Path(str(row["file_path"]))
    run_id = create_archive_run(import_id, path, trigger_type)
    if not path.exists() or not path.is_file():
        result = {
            "id": import_id,
            "archive_run_id": run_id,
            "status": "failed",
            "error": "input_file_not_found",
        }
        finish_import(import_id, "failed", None, "input_file_not_found")
        finish_archive_run(run_id, "failed", None, "input_file_not_found")
        return result

    try:
        workflow_result = run_archive_file(path, settings, limit)
    except Exception as exc:
        finish_import(import_id, "failed", None, str(exc))
        finish_archive_run(run_id, "failed", None, str(exc))
        raise

    finish_import(import_id, "completed", workflow_result, None)
    finish_archive_run(run_id, "completed", workflow_result, None)
    return {
        "id": import_id,
        "archive_run_id": run_id,
        "status": "completed",
        "result": workflow_result,
    }


def process_pending_imports(
    settings: Settings,
    limit: int | None = None,
    trigger_type: str = "manual_inbox",
) -> dict[str, object]:
    rows = list_inbox_imports(status="pending", limit=100)
    completed = 0
    failed = 0
    results: list[dict[str, object]] = []
    for row in rows:
        try:
            result = process_inbox_import(int(row["id"]), settings, limit, trigger_type)
            completed += 1 if result["status"] == "completed" else 0
            failed += 1 if result["status"] == "failed" else 0
            results.append(result)
        except Exception as exc:
            failed += 1
            results.append({"id": int(row["id"]), "status": "failed", "error": str(exc)})
    return {"processed": len(rows), "completed": completed, "failed": failed, "results": results}


def run_inbox_cycle(settings: Settings, limit: int | None = None) -> dict[str, object]:
    scan_result = scan_inbox(settings)
    process_result = process_pending_imports(settings, limit, "scheduled_inbox")
    return {"scan": scan_result, "process": process_result}


def claim_import(import_id: int) -> dict[str, object] | None:
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                update inbox_imports
                set status = 'processing', processing_started_at = now(), error_message = null
                where id = %s and status in ('pending', 'failed')
                returning id, file_path, file_type
                """,
                (import_id,),
            )
            row = cur.fetchone()
        conn.commit()
    return row


def finish_import(
    import_id: int,
    status: str,
    result: dict[str, object] | None,
    error_message: str | None,
) -> None:
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                update inbox_imports
                set status = %s, processed_at = now(), result = %s, error_message = %s
                where id = %s
                """,
                (status, Jsonb(result) if result is not None else None, error_message, import_id),
            )
        conn.commit()


def create_archive_run(import_id: int, path: Path, trigger_type: str) -> int:
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                insert into archive_runs (trigger_type, input_path, status)
                values (%s, %s, 'running')
                returning id
                """,
                (trigger_type, normalize_path(path)),
            )
            run_id = int(cur.fetchone()["id"])
            cur.execute(
                "update inbox_imports set archive_run_id = %s where id = %s",
                (run_id, import_id),
            )
        conn.commit()
    return run_id


def finish_archive_run(
    run_id: int,
    status: str,
    result: dict[str, object] | None,
    error_message: str | None,
) -> None:
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                update archive_runs
                set status = %s, finished_at = now(), result = %s, error_message = %s
                where id = %s
                """,
                (status, Jsonb(result) if result is not None else None, error_message, run_id),
            )
        conn.commit()


def get_scheduler_settings() -> dict[str, object]:
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                select enabled, interval_minutes, last_scan_at, next_scan_at, updated_at
                from inbox_scheduler_settings where id = 1
                """
            )
            row = cur.fetchone()
    if not row:
        raise RuntimeError("inbox_scheduler_settings_missing")
    return row


def update_scheduler_settings(enabled: bool, interval_minutes: int) -> dict[str, object]:
    next_scan_at = datetime.now(UTC) if enabled else None
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                update inbox_scheduler_settings
                set enabled = %s, interval_minutes = %s, next_scan_at = %s, updated_at = now()
                where id = 1
                returning enabled, interval_minutes, last_scan_at, next_scan_at, updated_at
                """,
                (enabled, interval_minutes, next_scan_at),
            )
            row = cur.fetchone()
        conn.commit()
    return row


def scheduler_due(settings_row: dict[str, object], now: datetime | None = None) -> bool:
    if not settings_row.get("enabled"):
        return False
    next_scan_at = settings_row.get("next_scan_at")
    return next_scan_at is None or next_scan_at <= (now or datetime.now(UTC))


def mark_scheduler_scan(settings: Settings, scanned_at: datetime) -> None:
    del settings
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                update inbox_scheduler_settings
                set last_scan_at = %s,
                    next_scan_at = case
                      when enabled then %s + make_interval(mins => interval_minutes)
                      else null
                    end,
                    updated_at = now()
                where id = 1
                """,
                (scanned_at, scanned_at),
            )
        conn.commit()
