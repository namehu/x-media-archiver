import unittest
from unittest.mock import MagicMock, patch

from xarchiver.recovery import DEFAULT_REQUEUE_STATUSES, fetch_requeue_candidates, requeue_tweets


class RecoveryServiceTests(unittest.TestCase):
    def test_requeue_tweets_returns_without_writes_when_no_candidates(self) -> None:
        with (
            patch(
                "xarchiver.recovery.fetch_requeue_candidates",
                return_value=[],
            ) as fetch_candidates,
            patch("xarchiver.recovery.connect") as connect,
        ):
            result = requeue_tweets(limit=5)

        self.assertEqual(result, {"requeued": 0, "statuses": DEFAULT_REQUEUE_STATUSES})
        fetch_candidates.assert_called_once_with(DEFAULT_REQUEUE_STATUSES, 5)
        connect.assert_not_called()

    def test_requeue_tweets_uses_custom_statuses(self) -> None:
        with patch("xarchiver.recovery.fetch_requeue_candidates", return_value=[]):
            result = requeue_tweets(["missing"], None)

        self.assertEqual(result["statuses"], ["missing"])

    def test_fetch_requeue_candidates_applies_limit_when_present(self) -> None:
        cursor = MagicMock()
        cursor.fetchall.return_value = [{"tweet_id": "1"}, {"tweet_id": "2"}]
        conn = MagicMock()
        conn.__enter__.return_value.cursor.return_value.__enter__.return_value = cursor
        with patch("xarchiver.recovery.connect", return_value=conn):
            result = fetch_requeue_candidates(["missing"], 2)

        self.assertEqual(result, ["1", "2"])
        sql, params = cursor.execute.call_args.args
        self.assertIn("limit %s", sql.lower())
        self.assertEqual(params, [["missing"], 2])


if __name__ == "__main__":
    unittest.main()
