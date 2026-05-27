import csv
import unittest

from xarchiver.archive import ensure_archive_dirs
from xarchiver.config import get_settings
from xarchiver.db import connect
from xarchiver.exporter import export_duplicates_csv, fetch_duplicate_rows


class DuplicateIntegrationTests(unittest.TestCase):
    tweet_ids = ["duplicate-fixture-1", "duplicate-fixture-2"]

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
                        values (%s, 1, 'photo', %s, 100, 'same-hash', 'test', 'verified')
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
                cur.execute("delete from tweets where tweet_id = any(%s)", (self.tweet_ids,))
            conn.commit()

    def test_fetch_duplicate_rows_and_export_csv(self) -> None:
        rows = [row for row in fetch_duplicate_rows() if row["sha256"] == "same-hash"]
        self.assertEqual(len(rows), 2)
        self.assertTrue(all(row["duplicate_count"] == 2 for row in rows))

        result = export_duplicates_csv(self.settings.archive_dir, self.output_path)
        self.assertGreaterEqual(result["rows"], 2)
        self.assertGreaterEqual(result["duplicate_groups"], 1)
        with self.output_path.open("r", encoding="utf-8-sig", newline="") as file:
            exported = [row for row in csv.DictReader(file) if row["sha256"] == "same-hash"]

        self.assertEqual(len(exported), 2)
        self.assertEqual(exported[0]["media_relative_path"], "media/dup/duplicate-fixture-1.jpg")


if __name__ == "__main__":
    unittest.main()
