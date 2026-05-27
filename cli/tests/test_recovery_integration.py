import unittest

from xarchiver.db import connect
from xarchiver.recovery import requeue_tweets


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


if __name__ == "__main__":
    unittest.main()
