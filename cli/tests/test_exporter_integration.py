import csv
import unittest

from xarchiver.archive import ensure_archive_dirs
from xarchiver.config import get_settings
from xarchiver.db import connect
from xarchiver.exporter import export_failures_csv


class ExporterIntegrationTests(unittest.TestCase):
    tweet_id = "failure-fixture-1"

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
            conn.commit()

    def tearDown(self) -> None:
        self.cleanup_db()
        if self.output_path.exists():
            self.output_path.unlink()

    def cleanup_db(self) -> None:
        with connect() as conn:
            with conn.cursor() as cur:
                cur.execute("delete from tweets where tweet_id = %s", (self.tweet_id,))
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


if __name__ == "__main__":
    unittest.main()
