import unittest
from unittest.mock import patch
from uuid import UUID, uuid4

from psycopg.types.json import Jsonb

from xarchiver.config import get_settings
from xarchiver.core.errors import ArchiverError
from xarchiver.db import connect
from xarchiver.services.media_deletion import MediaFileDeleteError, delete_media_assets


class MediaDeletionIntegrationTests(unittest.TestCase):
    tweet_id = "media-delete-fixture"

    def setUp(self) -> None:
        self.settings = get_settings()
        self.tweet_dir = self.settings.archive_dir / "media" / "delete-test" / self.tweet_id
        self.operation_ids: list[UUID] = []
        self.cleanup()
        self.tweet_dir.mkdir(parents=True, exist_ok=True)
        self.media_path = self.tweet_dir / f"{self.tweet_id}--p1.jpg"
        self.metadata_path = self.tweet_dir / f"{self.tweet_id}--p1.jpg.json"
        self.thumbnail_path = self.tweet_dir / f"{self.tweet_id}--p1.thumb.jpg"
        self.media_path.write_bytes(b"media-content")
        self.metadata_path.write_bytes(b"{}")
        self.thumbnail_path.write_bytes(b"thumb")
        with connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    insert into tweets (tweet_id, url, author_username, download_status)
                    values (%s, %s, 'delete-test', 'verified')
                    """,
                    (self.tweet_id, f"https://x.com/delete/status/{self.tweet_id}"),
                )
                cur.execute(
                    """
                    insert into media_assets (
                        tweet_id, media_index, media_type, local_path, metadata_path,
                        file_size, source_engine, download_status
                    )
                    values (%s, 1, 'photo', %s, %s, %s, 'test', 'verified')
                    returning id
                    """,
                    (self.tweet_id, str(self.media_path), str(self.metadata_path), self.media_path.stat().st_size),
                )
                self.media_id = int(cur.fetchone()["id"])
                cur.execute(
                    """
                    insert into download_attempts (tweet_id, media_asset_id, engine, status)
                    values (%s, %s, 'test', 'succeeded')
                    returning id
                    """,
                    (self.tweet_id, self.media_id),
                )
                self.attempt_id = int(cur.fetchone()["id"])
            conn.commit()

    def tearDown(self) -> None:
        self.cleanup()

    def cleanup(self) -> None:
        with connect() as conn:
            with conn.cursor() as cur:
                cur.execute("delete from tweets where tweet_id = %s", (self.tweet_id,))
                cur.execute("delete from archive_runs where trigger_type = 'test-delete'")
                if self.operation_ids:
                    cur.execute("delete from media_delete_operations where operation_id = any(%s)", (self.operation_ids,))
            conn.commit()
        if hasattr(self, "tweet_dir") and self.tweet_dir.exists():
            for path in self.tweet_dir.iterdir():
                path.unlink()
            self.tweet_dir.rmdir()

    def test_deletes_files_and_asset_but_preserves_history(self) -> None:
        operation_id = uuid4()
        self.operation_ids.append(operation_id)

        result = delete_media_assets(self.settings, operation_id, [self.media_id])
        repeated = delete_media_assets(self.settings, operation_id, [self.media_id])

        self.assertEqual(repeated, result)
        self.assertEqual(result["deleted_media_count"], 1)
        self.assertEqual(result["deleted_file_count"], 3)
        self.assertFalse(self.tweet_dir.exists())
        with connect() as conn:
            with conn.cursor() as cur:
                cur.execute("select count(*) as count from media_assets where id = %s", (self.media_id,))
                self.assertEqual(cur.fetchone()["count"], 0)
                cur.execute("select download_status, last_error from tweets where tweet_id = %s", (self.tweet_id,))
                tweet = cur.fetchone()
                self.assertEqual(tweet["download_status"], "missing")
                self.assertEqual(tweet["last_error"], "media_deleted_by_user")
                cur.execute("select media_asset_id from download_attempts where id = %s", (self.attempt_id,))
                self.assertIsNone(cur.fetchone()["media_asset_id"])
                cur.execute("select status from media_delete_operations where operation_id = %s", (operation_id,))
                self.assertEqual(cur.fetchone()["status"], "completed")

    def test_rejects_tweet_with_active_work(self) -> None:
        operation_id = uuid4()
        self.operation_ids.append(operation_id)
        with connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "insert into archive_runs (trigger_type, status) values ('test-delete', 'running') returning id"
                )
                run_id = int(cur.fetchone()["id"])
                cur.execute(
                    """
                    insert into archive_run_items (archive_run_id, tweet_id, input_payload, status)
                    values (%s, %s, %s, 'pending')
                    """,
                    (run_id, self.tweet_id, Jsonb({"url": "https://x.com/delete/status/test"})),
                )
            conn.commit()

        with self.assertRaises(ArchiverError) as ctx:
            delete_media_assets(self.settings, operation_id, [self.media_id])

        self.assertEqual(ctx.exception.code, "media_delete_active_work")
        self.assertTrue(self.media_path.exists())

    def test_failed_delete_audit_records_partial_progress(self) -> None:
        operation_id = uuid4()
        self.operation_ids.append(operation_id)
        partial = {
            "deleted_file_count": 1,
            "deleted_bytes": 123,
            "missing_file_count": 2,
        }

        with patch(
            "xarchiver.services.media_deletion._delete_files",
            side_effect=MediaFileDeleteError(PermissionError("test delete failure"), partial),
        ):
            with self.assertRaises(ArchiverError) as ctx:
                delete_media_assets(self.settings, operation_id, [self.media_id])

        self.assertEqual(ctx.exception.code, "media_file_delete_failed")
        with connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "select status, result, error_message from media_delete_operations where operation_id = %s",
                    (operation_id,),
                )
                audit = cur.fetchone()
        self.assertEqual(audit["status"], "failed")
        self.assertEqual(audit["result"]["partial_deleted_file_count"], 1)
        self.assertEqual(audit["result"]["partial_deleted_bytes"], 123)
        self.assertEqual(audit["result"]["missing_file_count"], 2)
        self.assertIn("test delete failure", audit["error_message"])


if __name__ == "__main__":
    unittest.main()
