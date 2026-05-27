import unittest

from xarchiver.db import connect
from xarchiver.recovery import recover_interrupted_runs, requeue_tweets


class RecoveryIntegrationTests(unittest.TestCase):
    tweet_id = "requeue-fixture-1"

    def setUp(self) -> None:
        self.cleanup_db()
        with connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    insert into tweets (tweet_id, url, download_status, last_error, retry_count)
                    values (%s, %s, 'corrupt', 'sha256_mismatch', 1)
                    """,
                    (self.tweet_id, f"https://x.com/test/status/{self.tweet_id}"),
                )
                cur.execute(
                    """
                    insert into media_assets (
                        tweet_id,
                        media_index,
                        local_path,
                        source_engine,
                        download_status,
                        error_message
                    )
                    values (%s, 1, '/tmp/missing.jpg', 'test', 'corrupt', 'sha256_mismatch')
                    """,
                    (self.tweet_id,),
                )
            conn.commit()

    def tearDown(self) -> None:
        self.cleanup_db()

    def cleanup_db(self) -> None:
        with connect() as conn:
            with conn.cursor() as cur:
                cur.execute("delete from tweets where tweet_id = %s", (self.tweet_id,))
            conn.commit()

    def test_requeue_tweets_resets_tweet_and_media_status(self) -> None:
        result = requeue_tweets(["corrupt"], None)

        self.assertGreaterEqual(result["requeued"], 1)
        with connect() as conn:
            with conn.cursor() as cur:
                cur.execute("select download_status, last_error from tweets where tweet_id = %s", (self.tweet_id,))
                tweet = cur.fetchone()
                cur.execute(
                    "select download_status, error_message from media_assets where tweet_id = %s",
                    (self.tweet_id,),
                )
                media = cur.fetchone()

        self.assertEqual(tweet["download_status"], "pending")
        self.assertIsNone(tweet["last_error"])
        self.assertEqual(media["download_status"], "pending")
        self.assertIsNone(media["error_message"])


class InterruptedRecoveryIntegrationTests(unittest.TestCase):
    tweet_id = "interrupted-fixture-1"

    def setUp(self) -> None:
        self.cleanup_db()
        with connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    insert into tweets (tweet_id, url, download_status, last_attempt_at)
                    values (%s, %s, 'downloading', now() - interval '3 hours')
                    """,
                    (self.tweet_id, f"https://x.com/test/status/{self.tweet_id}"),
                )
                cur.execute(
                    """
                    insert into download_jobs (job_type, engine, status, total_count, started_at)
                    values ('download', 'gallery-dl', 'running', 1, now() - interval '3 hours')
                    """
                )
            conn.commit()

    def tearDown(self) -> None:
        self.cleanup_db()
        with connect() as conn:
            with conn.cursor() as cur:
                cur.execute("delete from download_jobs where error_message = 'interrupted_download'")
            conn.commit()

    def cleanup_db(self) -> None:
        with connect() as conn:
            with conn.cursor() as cur:
                cur.execute("delete from tweets where tweet_id = %s", (self.tweet_id,))
            conn.commit()

    def test_recover_interrupted_runs_marks_stale_records_retryable(self) -> None:
        result = recover_interrupted_runs(120)

        self.assertGreaterEqual(result["tweets_recovered"], 1)
        self.assertGreaterEqual(result["jobs_recovered"], 1)
        with connect() as conn:
            with conn.cursor() as cur:
                cur.execute("select download_status, last_error from tweets where tweet_id = %s", (self.tweet_id,))
                tweet = cur.fetchone()

        self.assertEqual(tweet["download_status"], "failed_retryable")
        self.assertEqual(tweet["last_error"], "interrupted_download")


if __name__ == "__main__":
    unittest.main()
