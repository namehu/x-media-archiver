"""中断恢复与重新入队辅助函数。"""

from __future__ import annotations

from psycopg.types.json import Jsonb
from sqlalchemy import bindparam, delete, func, insert, select

from xarchiver.db import connect
from xarchiver.row_models import TweetIdRow
from xarchiver.sql_builder import compile_query
from xarchiver.tables import failure_action_events, failure_dispositions, tweets

DEFAULT_REQUEUE_STATUSES = ["failed_retryable", "missing", "corrupt"]


def requeue_tweets(statuses: list[str] | None = None, limit: int | None = None) -> dict[str, object]:
    """把指定状态的推文与媒体重新置回 pending。"""

    selected_statuses = statuses or DEFAULT_REQUEUE_STATUSES
    tweet_ids = fetch_requeue_candidates(selected_statuses, limit)
    if not tweet_ids:
        return {"requeued": 0, "statuses": selected_statuses}

    with connect() as conn:
        with conn.cursor() as cur:
            for tweet_id in sorted(set(tweet_ids)):
                cur.execute("select pg_advisory_xact_lock(hashtextextended(%s, 0))", (tweet_id,))
            cur.execute(
                """
                select tweet_id, download_status
                from tweets
                where tweet_id = any(%s)
                order by tweet_id
                for update
                """,
                (tweet_ids,),
            )
            previous_statuses = {
                str(row["tweet_id"]): str(row["download_status"])
                for row in cur.fetchall()
            }
            statement = delete(failure_dispositions).where(failure_dispositions.c.tweet_id.in_(tweet_ids))
            sql, params = compile_query(statement)
            cur.execute(sql, params)
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
            for tweet_id, previous_status in previous_statuses.items():
                if previous_status not in {"failed_retryable", "failed_permanent", "corrupt"}:
                    continue
                event_statement = insert(failure_action_events).values(
                    tweet_id=tweet_id,
                    action="retry",
                    previous_status=previous_status,
                    result=Jsonb({"trigger_type": "legacy_requeue"}),
                    created_at=func.now(),
                )
                sql, params = compile_query(event_statement)
                cur.execute(sql, params)
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
    """把超时未完成的下载与运行恢复为可重试状态。"""

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
                update archive_run_items i
                set status = case
                      when i.cancel_requested is true
                        or exists (
                          select 1 from failure_dispositions d where d.tweet_id = i.tweet_id
                        )
                      then 'cancelled'
                      else 'failed_retryable'
                    end,
                    error_category = case
                      when i.cancel_requested is true
                        or exists (
                          select 1 from failure_dispositions d where d.tweet_id = i.tweet_id
                        )
                      then null
                      else 'interrupted_download'
                    end,
                    error_message = case
                      when i.cancel_requested is true
                        or exists (
                          select 1 from failure_dispositions d where d.tweet_id = i.tweet_id
                        )
                      then null
                      else 'interrupted_download'
                    end,
                    next_attempt_at = case
                      when i.cancel_requested is true
                        or exists (
                          select 1 from failure_dispositions d where d.tweet_id = i.tweet_id
                        )
                      then null
                      else now()
                    end,
                    worker_id = null,
                    lease_expires_at = null,
                    progress_message = case
                      when i.cancel_requested is true
                        or exists (
                          select 1 from failure_dispositions d where d.tweet_id = i.tweet_id
                        )
                      then '已取消'
                      else '检测到下载中断，等待重试'
                    end,
                    last_progress_at = now(),
                    updated_at = now()
                where i.status = 'processing'
                  and i.last_attempt_at <= now() - make_interval(mins => %s)
                returning i.archive_run_id, i.status
                """,
                (stuck_timeout_minutes,),
            )
            recovered_items = [dict(row) for row in cur.fetchall()]
            items_recovered = len(recovered_items)
            items_cancelled = sum(1 for row in recovered_items if row["status"] == "cancelled")
            affected_run_ids = {int(row["archive_run_id"]) for row in recovered_items}
        conn.commit()

    # Local import avoids the queue -> workflow -> recovery import cycle.
    from xarchiver.services.queue import update_run_after_processing

    for run_id in sorted(affected_run_ids):
        update_run_after_processing(run_id, None)

    return {
        "tweets_recovered": tweets_recovered,
        "jobs_recovered": jobs_recovered,
        "items_recovered": items_recovered,
        "items_cancelled": items_cancelled,
    }


def fetch_requeue_candidates(statuses: list[str], limit: int | None) -> list[str]:
    """读取符合重新入队条件的 tweet_id 列表。"""

    sql, params = build_requeue_candidates_query(statuses, limit)

    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            return [row.tweet_id for row in (TweetIdRow.model_validate(dict(row)) for row in cur.fetchall())]


def build_requeue_candidates_query(statuses: list[str], limit: int | None) -> tuple[str, dict[str, object]]:
    """构造重新入队候选推文查询。"""

    statement = (
        select(tweets.c.tweet_id)
        .select_from(tweets)
        .where(tweets.c.download_status.in_(statuses))
        .order_by(tweets.c.updated_at.asc(), tweets.c.imported_at.asc())
    )
    if limit:
        statement = statement.limit(bindparam("limit", limit))
    return compile_query(statement)
