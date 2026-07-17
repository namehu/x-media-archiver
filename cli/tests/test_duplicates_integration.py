import csv
import unittest

from xarchiver.archive import ensure_archive_dirs
from xarchiver.config import get_settings
from xarchiver.db import connect
from xarchiver.exporter import export_duplicates_csv, fetch_duplicate_rows
from xarchiver.services.library import list_duplicates_page


class DuplicateIntegrationTests(unittest.TestCase):
    tweet_ids = ["duplicate-fixture-1", "duplicate-fixture-2"]
    other_tweet_ids = ["duplicate-fixture-3", "duplicate-fixture-4"]

    def setUp(self) -> None:
        self.settings = get_settings()
        ensure_archive_dirs(self.settings.archive_dir)
        self.output_path = self.settings.archive_dir / "exports" / "duplicates-fixture.csv"
        self.cleanup_db()
        if self.output_path.exists():
            self.output_path.unlink()
        with connect() as conn:
            with conn.cursor() as cur:
                for index, tweet_id in enumerate(self.tweet_ids, start=1):
                    media_status = "verified" if index == 1 else "downloaded"
                    cur.execute(
                        """
                        insert into tweets (tweet_id, url, author_username, download_status)
                        values (%s, %s, %s, 'verified')
                        """,
                        (tweet_id, f"https://x.com/dup/status/{tweet_id}", f"dup_author_{index}"),
                    )
                    cur.execute(
                        """
                        insert into media_assets (
                            tweet_id,
                            media_index,
                            media_type,
                            local_path,
                            file_size,
                            sha256,
                            source_engine,
                            download_status
                        )
                        values (%s, 1, 'photo', %s, 100, 'same-hash', 'test', %s)
                        """,
                        (tweet_id, f"/app/archive/media/dup/{tweet_id}.jpg", media_status),
                    )
                for index, tweet_id in enumerate(self.other_tweet_ids, start=3):
                    cur.execute(
                        """
                        insert into tweets (tweet_id, url, author_username, download_status)
                        values (%s, %s, %s, 'verified')
                        """,
                        (tweet_id, f"https://x.com/dup/status/{tweet_id}", f"dup_author_{index}"),
                    )
                    cur.execute(
                        """
                        insert into media_assets (
                            tweet_id,
                            media_index,
                            media_type,
                            local_path,
                            file_size,
                            sha256,
                            source_engine,
                            download_status
                        )
                        values (%s, 1, 'photo', %s, 200, 'same-hash-2', 'test', 'verified')
                        """,
                        (tweet_id, f"/app/archive/media/dup/{tweet_id}.jpg"),
                    )
            conn.commit()

    def tearDown(self) -> None:
        self.cleanup_db()
        if self.output_path.exists():
            self.output_path.unlink()

    def cleanup_db(self) -> None:
        with connect() as conn:
            with conn.cursor() as cur:
                cur.execute("delete from tweets where tweet_id = any(%s)", (self.tweet_ids + self.other_tweet_ids,))
            conn.commit()

    def test_fetch_duplicate_rows_and_export_csv(self) -> None:
        rows = [row for row in fetch_duplicate_rows() if row["sha256"] == "same-hash"]
        self.assertEqual(len(rows), 2)
        self.assertTrue(all(row["duplicate_count"] == 2 for row in rows))
        self.assertTrue(all(isinstance(row["id"], int) for row in rows))
        self.assertTrue(all(row["media_index"] == 1 for row in rows))

        result = export_duplicates_csv(self.settings.archive_dir, self.output_path)
        self.assertGreaterEqual(result["rows"], 2)
        self.assertGreaterEqual(result["duplicate_groups"], 1)
        with self.output_path.open("r", encoding="utf-8-sig", newline="") as file:
            exported = [row for row in csv.DictReader(file) if row["sha256"] == "same-hash"]

        self.assertEqual(len(exported), 2)
        self.assertEqual(exported[0]["media_relative_path"], "media/dup/duplicate-fixture-1.jpg")

    def test_duplicates_page_returns_current_rows_and_total_counts(self) -> None:
        page = list_duplicates_page(self.settings, limit=1, offset=0)

        self.assertEqual(page["count"], 1)
        self.assertEqual(len(page["groups"]), 1)
        self.assertEqual(len(page["groups"][0]["rows"]), 2)
        self.assertEqual(page["groups"][0]["duplicate_count"], 2)
        self.assertTrue(all(isinstance(row["id"], int) for row in page["groups"][0]["rows"]))
        self.assertEqual(page["groups"][0]["rows"][0]["media_status"], "verified")
        self.assertGreaterEqual(page["total_count"], 2)
        self.assertGreaterEqual(page["total_media_count"], 4)
        self.assertGreaterEqual(page["duplicate_groups"], 2)
        self.assertEqual(page["limit"], 1)
        self.assertEqual(page["offset"], 0)

        next_page = list_duplicates_page(self.settings, limit=1, offset=1)
        self.assertEqual(next_page["count"], 1)
        self.assertNotEqual(page["groups"][0]["sha256"], next_page["groups"][0]["sha256"])


if __name__ == "__main__":
    unittest.main()
