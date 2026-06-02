from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from sqlalchemy import bindparam, select

from xarchiver.db import connect
from xarchiver.media import sha256_file
from xarchiver.row_models import DownloadStatusCountRow, VerifiableAssetRow
from xarchiver.sql_builder import compile_query
from xarchiver.tables import media_assets

VERIFY_MEDIA_STATUSES = ("downloaded", "verified", "missing", "corrupt")


@dataclass(frozen=True)
class VerificationResult:
    media_id: int
    tweet_id: str
    status: str
    file_size: int | None
    sha256: str | None
    error_message: str | None


def verify_media_assets(limit: int | None = None, media_ids: list[int] | None = None) -> dict[str, int]:
    assets = fetch_verifiable_assets(limit, media_ids)
    results = [verify_asset(asset) for asset in assets]
    update_media_results(results)
    update_tweet_statuses(sorted({result.tweet_id for result in results}))

    counts = {"checked": len(results), "verified": 0, "missing": 0, "corrupt": 0}
    for result in results:
        counts[result.status] = counts.get(result.status, 0) + 1
    return counts


def fetch_verifiable_assets(
    limit: int | None,
    media_ids: list[int] | None = None,
) -> list[VerifiableAssetRow]:
    sql, params = build_verifiable_assets_query(limit=limit, media_ids=media_ids)

    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            return [VerifiableAssetRow.model_validate(dict(row)) for row in cur.fetchall()]


def build_verifiable_assets_query(
    limit: int | None,
    media_ids: list[int] | None = None,
) -> tuple[str, dict[str, object]]:
    statement = (
        select(
            media_assets.c.id,
            media_assets.c.tweet_id,
            media_assets.c.local_path,
            media_assets.c.sha256,
        )
        .select_from(media_assets)
        .where(media_assets.c.download_status.in_(VERIFY_MEDIA_STATUSES))
        .order_by(media_assets.c.updated_at.asc(), media_assets.c.id.asc())
    )
    if media_ids is not None:
        statement = statement.where(media_assets.c.id.in_(media_ids))
    if limit:
        statement = statement.limit(bindparam("limit", limit))
    return compile_query(statement)


def verify_asset(asset: VerifiableAssetRow) -> VerificationResult:
    media_id = int(asset["id"])
    tweet_id = str(asset["tweet_id"])
    local_path = Path(str(asset["local_path"] or ""))
    expected_sha256 = str(asset["sha256"] or "")

    if not local_path.exists():
        return VerificationResult(
            media_id=media_id,
            tweet_id=tweet_id,
            status="missing",
            file_size=None,
            sha256=expected_sha256 or None,
            error_message="file_missing",
        )

    actual_sha256 = sha256_file(local_path)
    file_size = local_path.stat().st_size
    if expected_sha256 and actual_sha256 != expected_sha256:
        return VerificationResult(
            media_id=media_id,
            tweet_id=tweet_id,
            status="corrupt",
            file_size=file_size,
            sha256=expected_sha256,
            error_message="sha256_mismatch",
        )

    return VerificationResult(
        media_id=media_id,
        tweet_id=tweet_id,
        status="verified",
        file_size=file_size,
        sha256=actual_sha256,
        error_message=None,
    )


def update_media_results(results: list[VerificationResult]) -> None:
    if not results:
        return
    with connect() as conn:
        with conn.cursor() as cur:
            for result in results:
                cur.execute(
                    """
                    update media_assets
                    set download_status = %s,
                        file_size = coalesce(%s, file_size),
                        sha256 = coalesce(%s, sha256),
                        error_message = %s,
                        updated_at = now()
                    where id = %s
                    """,
                    (
                        result.status,
                        result.file_size,
                        result.sha256,
                        result.error_message,
                        result.media_id,
                    ),
                )
        conn.commit()


def update_tweet_statuses(tweet_ids: list[str]) -> None:
    if not tweet_ids:
        return
    with connect() as conn:
        with conn.cursor() as cur:
            for tweet_id in tweet_ids:
                cur.execute(
                    """
                    select download_status, count(*) as count
                    from media_assets
                    where tweet_id = %s
                    group by download_status
                    """,
                    (tweet_id,),
                )
                status_counts = {
                    row.download_status: row.count
                    for row in (
                        DownloadStatusCountRow.model_validate(dict(row))
                        for row in cur.fetchall()
                    )
                }
                next_status = aggregate_tweet_status(status_counts)
                cur.execute(
                    """
                    update tweets
                    set download_status = %s,
                        last_error = %s,
                        updated_at = now()
                    where tweet_id = %s
                    """,
                    (
                        next_status,
                        None if next_status == "verified" else next_status,
                        tweet_id,
                    ),
                )
        conn.commit()


def aggregate_tweet_status(status_counts: dict[str, int]) -> str:
    total = sum(status_counts.values())
    if total == 0:
        return "missing"
    if status_counts.get("verified", 0) == total:
        return "verified"
    if status_counts.get("corrupt", 0):
        return "corrupt"
    if status_counts.get("missing", 0):
        return "missing"
    return "partial"
