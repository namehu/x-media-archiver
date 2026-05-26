from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from xarchiver.db import connect
from xarchiver.media import sha256_file


VERIFY_MEDIA_STATUSES = ("downloaded", "verified", "missing", "corrupt")


@dataclass(frozen=True)
class VerificationResult:
    media_id: int
    tweet_id: str
    status: str
    file_size: int | None
    sha256: str | None
    error_message: str | None


def verify_media_assets(limit: int | None = None) -> dict[str, int]:
    assets = fetch_verifiable_assets(limit)
    results = [verify_asset(asset) for asset in assets]
    update_media_results(results)
    update_tweet_statuses(sorted({result.tweet_id for result in results}))

    counts = {"checked": len(results), "verified": 0, "missing": 0, "corrupt": 0}
    for result in results:
        counts[result.status] = counts.get(result.status, 0) + 1
    return counts


def fetch_verifiable_assets(limit: int | None) -> list[dict[str, object]]:
    sql = """
        select id, tweet_id, local_path, sha256
        from media_assets
        where download_status = any(%s)
        order by updated_at asc, id asc
    """
    params: list[object] = [list(VERIFY_MEDIA_STATUSES)]
    if limit:
        sql += " limit %s"
        params.append(limit)

    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            return list(cur.fetchall())


def verify_asset(asset: dict[str, object]) -> VerificationResult:
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
                status_counts = {row["download_status"]: int(row["count"]) for row in cur.fetchall()}
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
