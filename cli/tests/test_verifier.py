import unittest

from xarchiver.verifier import aggregate_tweet_status


class VerifierUnitTests(unittest.TestCase):
    def test_all_verified_aggregates_to_verified(self) -> None:
        self.assertEqual(aggregate_tweet_status({"verified": 2}), "verified")

    def test_any_corrupt_aggregates_to_corrupt(self) -> None:
        self.assertEqual(aggregate_tweet_status({"verified": 1, "corrupt": 1}), "corrupt")

    def test_missing_without_corrupt_aggregates_to_missing(self) -> None:
        self.assertEqual(aggregate_tweet_status({"verified": 1, "missing": 1}), "missing")

    def test_mixed_downloaded_aggregates_to_partial(self) -> None:
        self.assertEqual(aggregate_tweet_status({"verified": 1, "downloaded": 1}), "partial")


if __name__ == "__main__":
    unittest.main()
