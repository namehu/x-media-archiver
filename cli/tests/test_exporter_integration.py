import csv
import unittest

from psycopg.types.json import Jsonb

from xarchiver.archive import ensure_archive_dirs
from xarchiver.config import get_settings
from xarchiver.db import connect
from xarchiver.exporter import (
    count_failure_rows,
    export_failures_csv,
    fetch_failure_categories,
    fetch_failure_rows,
)
from xarchiver.importer import upsert_tweets
from xarchiver.services.failures import ignore_failures


class ExporterIntegrationTests(unittest.TestCase):
    tweet_id = "failure-fixture-1"
    missing_tweet_id = "failure-fixture-missing"
    corrupt_tweet_id = "failure-fixture-corrupt"
    long_error_tweet_id = "failure-fixture-long-error"

    def setUp(self) -> None:
        self.settings = get_settings()
        ensure_archive_dirs(self.settings.archive_dir)
        self.output_path = self.settings.archive_dir / "exports" / "failures-fixture.csv"
        self.cleanup_db()
        if self.output_path.exists():
            self.output_path.unlink()
        with connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    insert into tweets (tweet_id, url, download_status, last_error, retry_count)
                    values (%s, %s, 'failed_retryable', 'no_downloaded_files', 1)
                    """,
                    (self.tweet_id, f"https://x.com/test/status/{self.tweet_id}"),
                )
                cur.execute(
                    """
                    insert into download_attempts (
                        tweet_id,
                        engine,
                        status,
                        exit_code,
                        error_category,
                        error_message,
                        finished_at
                    )
                    values (%s, 'gallery-dl', 'failed_retryable', 0, 'no_downloaded_files', 'no_downloaded_files', now())
                    """,
                    (self.tweet_id,),
                )
                cur.execute(
                    """
                    insert into tweets (tweet_id, url, download_status, last_error, retry_count)
                    values (%s, %s, 'missing', 'file_missing', 0)
                    """,
                    (self.missing_tweet_id, f"https://x.com/test/status/{self.missing_tweet_id}"),
                )
                cur.execute(
                    """
                    insert into tweets (tweet_id, url, download_status, last_error, retry_count, updated_at)
                    values (%s, %s, 'corrupt', 'sha256_mismatch', 0, now())
                    """,
                    (self.corrupt_tweet_id, f"https://x.com/test/status/{self.corrupt_tweet_id}"),
                )
                cur.execute(
                    """
                    insert into download_attempts (
                        tweet_id, engine, status, error_category, error_message, finished_at
                    )
                    values (%s, 'gallery-dl', 'failed_retryable', 'old_network_error', 'old error', now() - interval '30 days')
                    """,
                    (self.corrupt_tweet_id,),
                )
                cur.execute(
                    """
                    insert into tweets (tweet_id, url, download_status, last_error, retry_count)
                    values (%s, %s, 'failed_permanent', %s, 0)
                    """,
                    (
                        self.long_error_tweet_id,
                        f"https://x.com/test/status/{self.long_error_tweet_id}",
                        "x" * 500,
                    ),
                )
            conn.commit()

    def tearDown(self) -> None:
        self.cleanup_db()
        if self.output_path.exists():
            self.output_path.unlink()

    def cleanup_db(self) -> None:
        with connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    delete from archive_runs
                    where trigger_type = 'test_failure_timestamp'
                    """
                )
                cur.execute(
                    "delete from tweets where tweet_id = any(%s)",
                    ([self.tweet_id, self.missing_tweet_id, self.corrupt_tweet_id, self.long_error_tweet_id],),
                )
            conn.commit()

    def test_export_failures_csv_writes_latest_attempt(self) -> None:
        result = export_failures_csv(self.settings.archive_dir, self.output_path)

        self.assertGreaterEqual(result["rows"], 1)
        with self.output_path.open("r", encoding="utf-8-sig", newline="") as file:
            rows = list(csv.DictReader(file))

        row = next(row for row in rows if row["tweet_id"] == self.tweet_id)
        self.assertEqual(row["tweet_status"], "failed_retryable")
        self.assertEqual(row["latest_engine"], "gallery-dl")
        self.assertEqual(row["latest_error_category"], "no_downloaded_files")
        self.assertEqual(row["disposition"], "open")
        self.assertNotIn(self.missing_tweet_id, {row["tweet_id"] for row in rows})

    def test_failure_rows_exclude_missing_status(self) -> None:
        rows = fetch_failure_rows()
        tweet_ids = {row.tweet_id for row in rows}

        self.assertIn(self.tweet_id, tweet_ids)
        self.assertNotIn(self.missing_tweet_id, tweet_ids)
        self.assertEqual(count_failure_rows(), len(rows))

    def test_failure_export_keeps_ignored_rows_with_disposition(self) -> None:
        with connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    insert into failure_dispositions (tweet_id, reason, note)
                    values (%s, 'unsupported', 'waiting')
                    """,
                    (self.tweet_id,),
                )
            conn.commit()

        export_failures_csv(self.settings.archive_dir, self.output_path)
        with self.output_path.open("r", encoding="utf-8-sig", newline="") as file:
            row = next(row for row in csv.DictReader(file) if row["tweet_id"] == self.tweet_id)

        self.assertEqual(row["disposition"], "ignored")
        self.assertEqual(row["ignore_reason"], "unsupported")
        self.assertEqual(row["ignore_note"], "waiting")
        self.assertEqual(count_failure_rows(disposition="open", search=self.tweet_id), 0)

    def test_failure_time_uses_newer_tweet_state_change_than_old_attempt(self) -> None:
        row = fetch_failure_rows(search=self.corrupt_tweet_id)[0]

        self.assertIsNotNone(row.latest_finished_at)
        self.assertIsNotNone(row.failure_at)
        self.assertGreater(row.failure_at, row.latest_finished_at)
        self.assertEqual(row.latest_error_category, "corrupt")

    def test_reimport_does_not_change_failure_time_or_structured_category(self) -> None:
        before = fetch_failure_rows(search=self.tweet_id)[0]

        upsert_tweets(
            [
                {
                    "tweet_id": self.tweet_id,
                    "url": f"https://x.com/updated/status/{self.tweet_id}",
                    "author_username": "updated_author",
                    "author_display_name": None,
                    "published_at": None,
                    "text": "updated metadata",
                    "source_type": "test_reimport",
                    "source_url": None,
                    "collected_at": None,
                    "raw_import": {"url": f"https://x.com/updated/status/{self.tweet_id}"},
                }
            ]
        )

        after = fetch_failure_rows(search=self.tweet_id)[0]
        self.assertEqual(after.failure_at, before.failure_at)
        self.assertEqual(after.latest_error_category, "no_downloaded_files")

    def test_ignore_does_not_change_item_failure_time_or_category(self) -> None:
        with connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    insert into archive_runs (trigger_type, status, result)
                    values ('test_failure_timestamp', 'queued', '{}'::jsonb)
                    returning id
                    """
                )
                run_id = int(cur.fetchone()["id"])
                cur.execute(
                    """
                    insert into archive_run_items (
                      archive_run_id, tweet_id, input_payload, status, retry_count,
                      error_category, error_message
                    )
                    values (%s, %s, %s, 'failed_retryable', 1, 'rate_limited', 'rate limited')
                    """,
                    (
                        run_id,
                        self.tweet_id,
                        Jsonb({"url": f"https://x.com/test/status/{self.tweet_id}"}),
                    ),
                )
            conn.commit()

        before = fetch_failure_rows(search=self.tweet_id)[0]
        ignore_failures([self.tweet_id], reason="not_needed")
        after = fetch_failure_rows(search=self.tweet_id)[0]

        self.assertEqual(after.failure_at, before.failure_at)
        self.assertEqual(after.latest_error_category, "rate_limited")

    def test_error_categories_never_use_unstructured_last_error_text(self) -> None:
        row = fetch_failure_rows(search=self.long_error_tweet_id)[0]
        categories = fetch_failure_categories(search=self.long_error_tweet_id)

        self.assertEqual(row.latest_error_category, "failed_permanent")
        self.assertEqual([(category.error_category, category.count) for category in categories], [("failed_permanent", 1)])


if __name__ == "__main__":
    unittest.main()
