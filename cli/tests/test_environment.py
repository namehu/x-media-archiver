import unittest
from urllib.parse import urlparse

from xarchiver.config import get_settings


class TestEnvironmentSafetyTests(unittest.TestCase):
    def test_database_url_points_to_local_test_target(self) -> None:
        parsed = urlparse(get_settings().database_url)
        host = (parsed.hostname or "").lower()
        database = (parsed.path or "").lstrip("/").lower()
        user = (parsed.username or "").lower()

        self.assertIn(
            host,
            {"postgres", "localhost", "127.0.0.1"},
            "Tests must not run against a remote database.",
        )
        self.assertTrue(
            "xarchiver" in database or "xarchiver" in user,
            "Tests must run against an xarchiver development/test database.",
        )


if __name__ == "__main__":
    unittest.main()
