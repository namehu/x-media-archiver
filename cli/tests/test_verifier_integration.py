import unittest
from pathlib import Path

from xarchiver.archive import ensure_archive_dirs
from xarchiver.config import get_settings
from xarchiver.db import connect
from xarchiver.media import sha256_file
from xarchiver.verifier import verify_media_assets


class VerifierIntegrationTests(unittest.TestCase):
    tweet_id = "verify-fixture-1"

    def setUp(self) -> None:
        self.settings = get_settings()
        ensure_archive_dirs(self.settings.archive_dir)
        self.fixture_dir = self.settings.archive_dir / "media" / "_verify-fixtures"
        self.fixture_dir.mkdir(parents=True, exist_ok=True)
        self.fixture_path = self.fixture_dir / "verify-fixture-1.txt"
        self.fixture_path.write_text("original", encoding="utf-8")
        self.expected_sha256 = sha256_file(self.fixture_path)
        self.cleanup_db()
        with connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    insert into tweets (tweet_id, url, download_status)
                    values (%s, %s, 'downloaded')
                    """,
                    (self.tweet_id, f"https://x.com/test/status/{self.tweet_id}"),
                )
                cur.execute(
                    """
                    insert into media_assets (
                        tweet_id,
                        media_index,
                        media_type,
                        local_path,
                        file_ext,
                        file_size,
                        sha256,
                        source_engine,
                        download_status
                    )
                    values (%s, 1, 'photo', %s, 'txt', %s, %s, 'test', 'downloaded')
                    """,
                    (
                        self.tweet_id,
                        self.fixture_path.as_posix(),
                        self.fixture_path.stat().st_size,
                        self.expected_sha256,
                    ),
                )
            conn.commit()

    def tearDown(self) -> None:
        self.cleanup_db()
        if self.fixture_path.exists():
            self.fixture_path.unlink()

    def cleanup_db(self) -> None:
        with connect() as conn:
            with conn.cursor() as cur:
                cur.execute("delete from tweets where tweet_id = %s", (self.tweet_id,))
            conn.commit()

    def test_verify_missing_corrupt_and_recovery(self) -> None:
        verify_media_assets()
        self.assert_statuses("verified", "verified")

        self.fixture_path.unlink()
        verify_media_assets()
        self.assert_statuses("missing", "missing")

        self.fixture_path.write_text("changed", encoding="utf-8")
        verify_media_assets()
        self.assert_statuses("corrupt", "corrupt")

        self.fixture_path.write_text("original", encoding="utf-8")
        verify_media_assets()
        self.assert_statuses("verified", "verified")

    def test_empty_incremental_scope_does_not_verify_existing_media(self) -> None:
        result = verify_media_assets(media_ids=[])

        self.assertEqual(result["checked"], 0)
        self.assert_statuses("downloaded", "downloaded")

    def assert_statuses(self, tweet_status: str, media_status: str) -> None:
        with connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    select t.download_status as tweet_status,
                           m.download_status as media_status
                    from tweets t
                    join media_assets m on m.tweet_id = t.tweet_id
                    where t.tweet_id = %s
                    """,
                    (self.tweet_id,),
                )
                row = cur.fetchone()
        self.assertEqual(row["tweet_status"], tweet_status)
        self.assertEqual(row["media_status"], media_status)


if __name__ == "__main__":
    unittest.main()
