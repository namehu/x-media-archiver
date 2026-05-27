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


def recover_interrupted_runs(stuck_timeout_minutes: int) -> dict[str, int]:
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                update tweets
                set download_status = 'failed_retryable',
                    last_error = 'interrupted_download',
                    updated_at = now()
                where download_status = 'downloading'
                  and last_attempt_at <= now() - make_interval(mins => %s)
                """,
                (stuck_timeout_minutes,),
            )
            tweets_recovered = cur.rowcount

            cur.execute(
                """
                update download_jobs
                set status = 'failed',
                    failed_count = greatest(failed_count, total_count - success_count),
                    error_message = 'interrupted_download',
                    finished_at = now()
                where status = 'running'
                  and started_at <= now() - make_interval(mins => %s)
                """,
                (stuck_timeout_minutes,),
            )
            jobs_recovered = cur.rowcount

            cur.execute(
                """
                update archive_run_items
                set status = 'failed_retryable',
                    error_category = 'interrupted_download',
                    error_message = 'interrupted_download',
                    next_attempt_at = now(),
                    updated_at = now()
                where status = 'processing'
                  and last_attempt_at <= now() - make_interval(mins => %s)
                """,
                (stuck_timeout_minutes,),
            )
            items_recovered = cur.rowcount
        conn.commit()

    return {
        "tweets_recovered": tweets_recovered,
        "jobs_recovered": jobs_recovered,
        "items_recovered": items_recovered,
    }


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
