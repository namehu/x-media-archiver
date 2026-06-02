from __future__ import annotations

from sqlalchemy import bindparam, select

from xarchiver.db import connect
from xarchiver.row_models import TweetIdRow
from xarchiver.sql_builder import compile_query
from xarchiver.tables import tweets


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
    sql, params = build_requeue_candidates_query(statuses, limit)

    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            return [row.tweet_id for row in (TweetIdRow.model_validate(dict(row)) for row in cur.fetchall())]


def build_requeue_candidates_query(statuses: list[str], limit: int | None) -> tuple[str, dict[str, object]]:
    statement = (
        select(tweets.c.tweet_id)
        .select_from(tweets)
        .where(tweets.c.download_status.in_(statuses))
        .order_by(tweets.c.updated_at.asc(), tweets.c.imported_at.asc())
    )
    if limit:
        statement = statement.limit(bindparam("limit", limit))
    return compile_query(statement)
