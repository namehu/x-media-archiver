from __future__ import annotations

from xarchiver.db import connect


DEFAULT_REQUEUE_STATUSES = ["failed_retryable", "missing", "corrupt"]


def requeue_tweets(statuses: list[str] | None = None, limit: int | None = None) -> dict[str, object]:
    selected_statuses = statuses or DEFAULT_REQUEUE_STATUSES
    tweet_ids = fetch_requeue_candidates(selected_statuses, limit)
    if not tweet_ids:
        return {"requeued": 0, "statuses": selected_statuses}

    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                update tweets
                set download_status = 'pending',
                    last_error = null,
                    updated_at = now()
                where tweet_id = any(%s)
                """,
                (tweet_ids,),
            )
            cur.execute(
                """
                update media_assets
                set download_status = 'pending',
                    error_message = null,
                    updated_at = now()
                where tweet_id = any(%s)
                  and download_status in ('missing', 'corrupt', 'failed_retryable')
                """,
                (tweet_ids,),
            )
        conn.commit()

    return {"requeued": len(tweet_ids), "statuses": selected_statuses}


def fetch_requeue_candidates(statuses: list[str], limit: int | None) -> list[str]:
    sql = """
        select tweet_id
        from tweets
        where download_status = any(%s)
        order by updated_at asc, imported_at asc
    """
    params: list[object] = [statuses]
    if limit:
        sql += " limit %s"
        params.append(limit)

    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            return [str(row["tweet_id"]) for row in cur.fetchall()]
