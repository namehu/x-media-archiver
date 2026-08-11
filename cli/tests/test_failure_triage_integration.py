import unittest
from types import SimpleNamespace
from unittest.mock import patch

from psycopg.types.json import Jsonb

from xarchiver.db import connect
from xarchiver.recovery import recover_interrupted_runs
from xarchiver.services.failures import (
    ignore_failures,
    list_failure_actions,
    list_failures,
    restore_failures,
    retry_failures,
)
from xarchiver.services.queue import (
    claim_next_items,
    fail_processing_items,
    get_run_detail,
    has_runnable_download_work,
    submit_archive_batch,
    submit_explicit_retry_batch,
    update_processed_items,
)


class FailureTriageIntegrationTests(unittest.TestCase):
    tweet_ids = ["920000000000000001", "920000000000000002", "920000000000000003"]

    def setUp(self) -> None:
        self.cleanup_db()

    def tearDown(self) -> None:
        self.cleanup_db()

    def cleanup_db(self) -> None:
        with connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    delete from archive_runs
                    where exists (
                      select 1 from archive_run_items i
                      where i.archive_run_id = archive_runs.id and i.tweet_id = any(%s)
                    )
                    """,
                    (self.tweet_ids,),
                )
                cur.execute("delete from tweets where tweet_id = any(%s)", (self.tweet_ids,))
            conn.commit()

    def create_failure(self, tweet_id: str, status: str = "failed_retryable", *, with_run: bool = False) -> int | None:
        with connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    insert into tweets (tweet_id, url, download_status, last_error, retry_count)
                    values (%s, %s, %s, 'network_error', 2)
                    """,
                    (tweet_id, f"https://x.com/test/status/{tweet_id}", status),
                )
                if not with_run:
                    conn.commit()
                    return None
                cur.execute(
                    """
                    insert into archive_runs (trigger_type, status, result)
                    values ('test_failure_triage', 'queued', '{}'::jsonb)
                    returning id
                    """
                )
                run_id = int(cur.fetchone()["id"])
                cur.execute(
                    """
                    insert into archive_run_items (archive_run_id, tweet_id, input_payload, status, retry_count)
                    values (%s, %s, %s, 'failed_retryable', 2)
                    """,
                    (run_id, tweet_id, Jsonb({"url": f"https://x.com/test/status/{tweet_id}"})),
                )
            conn.commit()
        return run_id

    def test_ignore_stops_retry_and_duplicate_submission_is_skipped(self) -> None:
        tweet_id = self.tweet_ids[0]
        original_run_id = self.create_failure(tweet_id, with_run=True)

        result = ignore_failures([tweet_id], reason="unsupported", note="等待工具支持")
        with connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    insert into archive_runs (trigger_type, status, result)
                    values ('test_failure_triage_recovered', 'queued', '{}'::jsonb)
                    returning id
                    """
                )
                recovered_run_id = int(cur.fetchone()["id"])
                cur.execute(
                    """
                    insert into archive_run_items (archive_run_id, tweet_id, input_payload, status)
                    values (%s, %s, %s, 'pending')
                    """,
                    (recovered_run_id, tweet_id, Jsonb({"url": f"https://x.com/test/status/{tweet_id}"})),
                )
            conn.commit()
        repeated = ignore_failures([tweet_id])
        submitted = submit_archive_batch(
            [{"url": f"https://x.com/test/status/{tweet_id}"}],
            "test_failure_triage_resubmit",
        )

        self.assertEqual(result["succeeded_count"], 1)
        self.assertEqual(result["cancelled_items"], 1)
        self.assertEqual(repeated["skip_reasons"], {"already_ignored": 1})
        self.assertEqual(repeated["cancelled_items"], 1)
        self.assertEqual(submitted["tasks"]["skipped_ignored_count"], 1)
        self.assertEqual(get_run_detail(int(submitted["run_id"]))["items"][0]["status"], "skipped_ignored")
        with connect() as conn:
            with conn.cursor() as cur:
                cur.execute("select reason, note from failure_dispositions where tweet_id = %s", (tweet_id,))
                disposition = cur.fetchone()
                cur.execute("select status from archive_run_items where archive_run_id = %s", (original_run_id,))
                old_item = cur.fetchone()
        self.assertEqual(disposition["reason"], "unsupported")
        self.assertEqual(disposition["note"], "等待工具支持")
        self.assertEqual(old_item["status"], "cancelled")
        self.assertEqual(get_run_detail(recovered_run_id)["items"][0]["status"], "cancelled")

    def test_restore_reopens_without_queuing_and_records_audit(self) -> None:
        tweet_id = self.tweet_ids[0]
        self.create_failure(tweet_id)
        ignore_failures([tweet_id], reason="not_needed")

        result = restore_failures([tweet_id])
        page = list_failures(disposition="open", search=tweet_id)
        history = list_failure_actions(tweet_id)

        self.assertEqual(result["succeeded_count"], 1)
        self.assertEqual(page["total_count"], 1)
        self.assertEqual([row["disposition"] for row in page["rows"]], ["open"])
        self.assertEqual([event["action"] for event in history["rows"]], ["restore", "ignore"])
        with connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    select count(*)::int as count
                    from archive_runs r
                    where r.trigger_type = 'manual_retry'
                      and exists (
                        select 1 from archive_run_items i
                        where i.archive_run_id = r.id and i.tweet_id = %s
                      )
                    """,
                    (tweet_id,),
                )
                retry_run_count = int(cur.fetchone()["count"])
        self.assertEqual(retry_run_count, 0)

    def test_retry_is_exact_resets_budget_and_partially_skips_stale_rows(self) -> None:
        failed_id, healthy_id = self.tweet_ids[:2]
        original_run_id = self.create_failure(failed_id, with_run=True)
        self.create_failure(healthy_id, status="verified")
        with connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "insert into failure_dispositions (tweet_id, reason) values (%s, 'other')",
                    (failed_id,),
                )
            conn.commit()

        result = retry_failures([failed_id, healthy_id])

        self.assertEqual(result["succeeded_count"], 1)
        self.assertEqual(result["skipped_count"], 1)
        self.assertEqual(result["skip_reasons"], {"not_failure": 1})
        self.assertIsInstance(result["run_id"], int)
        detail = get_run_detail(int(result["run_id"]))
        self.assertEqual(detail["trigger_type"], "manual_retry")
        self.assertEqual(detail["items"][0]["tweet_id"], failed_id)
        self.assertEqual(detail["items"][0]["status"], "pending")
        with connect() as conn:
            with conn.cursor() as cur:
                cur.execute("select download_status, retry_count from tweets where tweet_id = %s", (failed_id,))
                tweet = cur.fetchone()
                cur.execute("select status from archive_run_items where archive_run_id = %s", (original_run_id,))
                old_item = cur.fetchone()
                cur.execute("select count(*)::int as count from failure_dispositions where tweet_id = %s", (failed_id,))
                disposition_count = int(cur.fetchone()["count"])
        self.assertEqual(tweet["download_status"], "pending")
        self.assertEqual(tweet["retry_count"], 0)
        self.assertEqual(old_item["status"], "cancelled")
        self.assertEqual(disposition_count, 0)

    def test_only_success_clears_current_disposition_and_records_resolution(self) -> None:
        tweet_id = self.tweet_ids[0]
        self.create_failure(tweet_id, status="corrupt")
        ignore_failures([tweet_id], reason="unavailable")

        with connect() as conn:
            with conn.cursor() as cur:
                cur.execute("update tweets set download_status = 'pending' where tweet_id = %s", (tweet_id,))
                cur.execute("update tweets set download_status = 'downloading' where tweet_id = %s", (tweet_id,))
            conn.commit()

        with connect() as conn:
            with conn.cursor() as cur:
                cur.execute("select count(*)::int as count from failure_dispositions where tweet_id = %s", (tweet_id,))
                disposition_count = int(cur.fetchone()["count"])
        self.assertEqual(disposition_count, 1)

        with connect() as conn:
            with conn.cursor() as cur:
                cur.execute("update tweets set download_status = 'verified' where tweet_id = %s", (tweet_id,))
            conn.commit()

        with connect() as conn:
            with conn.cursor() as cur:
                cur.execute("select count(*)::int as count from failure_dispositions where tweet_id = %s", (tweet_id,))
                disposition_count = int(cur.fetchone()["count"])
        self.assertEqual(disposition_count, 0)
        self.assertEqual(
            [event["action"] for event in list_failure_actions(tweet_id)["rows"]],
            ["resolved", "ignore"],
        )

    def test_ignore_after_claim_converges_normal_worker_finish_to_cancelled(self) -> None:
        tweet_id = self.tweet_ids[0]
        run_id = self.create_failure(tweet_id, with_run=True)
        claimed = claim_next_items(retry_limit=5, worker_id="triage-normal")
        self.assertEqual([row.tweet_id for row in claimed], [tweet_id])

        ignore_failures([tweet_id], reason="not_needed")
        with connect() as conn:
            with conn.cursor() as cur:
                cur.execute("update tweets set download_status = 'downloading' where tweet_id = %s", (tweet_id,))
                cur.execute("update tweets set download_status = 'failed_retryable' where tweet_id = %s", (tweet_id,))
            conn.commit()

        update_processed_items(
            int(run_id),
            claimed,
            SimpleNamespace(retry_limit=5, retry_backoff_minutes=1),
            {},
            worker_id="triage-normal",
        )

        self.assertEqual(get_run_detail(int(run_id))["items"][0]["status"], "cancelled")
        self.assertFalse(has_runnable_download_work(retry_limit=5))
        with connect() as conn:
            with conn.cursor() as cur:
                cur.execute("select count(*)::int as count from failure_dispositions where tweet_id = %s", (tweet_id,))
                self.assertEqual(int(cur.fetchone()["count"]), 1)

    def test_ignore_after_claim_converges_worker_exception_to_cancelled(self) -> None:
        tweet_id = self.tweet_ids[0]
        run_id = self.create_failure(tweet_id, with_run=True)
        claimed = claim_next_items(retry_limit=5, worker_id="triage-error")
        self.assertEqual([row.tweet_id for row in claimed], [tweet_id])

        ignore_failures([tweet_id], reason="not_needed")
        fail_processing_items(
            int(run_id),
            claimed,
            SimpleNamespace(retry_limit=5, retry_backoff_minutes=1),
            "simulated worker error",
            worker_id="triage-error",
        )

        item = get_run_detail(int(run_id))["items"][0]
        self.assertEqual(item["status"], "cancelled")
        self.assertIsNone(item["next_attempt_at"])
        self.assertFalse(has_runnable_download_work(retry_limit=5))

    def test_ignore_after_claim_converges_crash_recovery_to_cancelled(self) -> None:
        tweet_id = self.tweet_ids[0]
        run_id = self.create_failure(tweet_id, with_run=True)
        claimed = claim_next_items(retry_limit=5, worker_id="triage-crashed")
        self.assertEqual([row.tweet_id for row in claimed], [tweet_id])
        ignore_failures([tweet_id], reason="not_needed")
        with connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "update tweets set download_status = 'downloading', last_attempt_at = now() - interval '3 hours' where tweet_id = %s",
                    (tweet_id,),
                )
                cur.execute(
                    "update archive_run_items set last_attempt_at = now() - interval '3 hours' where archive_run_id = %s",
                    (run_id,),
                )
            conn.commit()

        recovered = recover_interrupted_runs(120)

        self.assertGreaterEqual(recovered["items_cancelled"], 1)
        detail = get_run_detail(int(run_id))
        self.assertEqual(detail["items"][0]["status"], "cancelled")
        self.assertEqual(detail["status"], "stopped")
        self.assertFalse(has_runnable_download_work(retry_limit=5))

    def test_explicit_retry_rolls_back_status_and_disposition_when_run_creation_fails(self) -> None:
        tweet_id = self.tweet_ids[0]
        self.create_failure(tweet_id)
        ignore_failures([tweet_id], reason="other")

        with (
            patch("xarchiver.services.queue.submit_archive_batch", side_effect=RuntimeError("run insert failed")),
            self.assertRaisesRegex(RuntimeError, "run insert failed"),
        ):
            submit_explicit_retry_batch(
                [{"url": f"https://x.com/test/status/{tweet_id}"}],
                "manual_retry",
            )

        with connect() as conn:
            with conn.cursor() as cur:
                cur.execute("select download_status from tweets where tweet_id = %s", (tweet_id,))
                self.assertEqual(cur.fetchone()["download_status"], "failed_retryable")
                cur.execute("select count(*)::int as count from failure_dispositions where tweet_id = %s", (tweet_id,))
                self.assertEqual(int(cur.fetchone()["count"]), 1)


if __name__ == "__main__":
    unittest.main()
