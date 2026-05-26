import unittest

from xarchiver.importer import extract_tweet_id


class ImporterTests(unittest.TestCase):
    def test_extract_tweet_id_from_x_status_url(self) -> None:
        self.assertEqual(
            extract_tweet_id("https://x.com/PhysInHistory/status/2058554692586885322"),
            "2058554692586885322",
        )

    def test_extract_tweet_id_strips_query(self) -> None:
        self.assertEqual(
            extract_tweet_id("https://twitter.com/user/status/1234567890?s=20"),
            "1234567890",
        )

    def test_extract_tweet_id_rejects_profile_url(self) -> None:
        with self.assertRaises(ValueError):
            extract_tweet_id("https://x.com/XiangHupt/likes")


if __name__ == "__main__":
    unittest.main()
