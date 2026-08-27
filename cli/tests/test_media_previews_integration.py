import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from PIL import Image

from xarchiver.db import connect
from xarchiver.services.media_previews import (
    cancel_media_preview_job,
    create_media_preview_job,
    get_media_preview_schedule,
    list_media_preview_jobs,
    process_next_media_preview_job,
    update_media_preview_schedule,
)


class MediaPreviewIntegrationTests(unittest.TestCase):
    tweet_id = "926000000000000001"

    def setUp(self) -> None:
        self.job_ids: list[int] = []
        self.temp_dir = tempfile.TemporaryDirectory()
        self.archive_dir = Path(self.temp_dir.name) / "archive"
        media_dir = self.archive_dir / "media" / "preview-test" / self.tweet_id
        media_dir.mkdir(parents=True)
        self.media_path = media_dir / "image.png"
        Image.new("RGB", (1200, 800), (20, 100, 180)).save(self.media_path)
        with connect() as conn:
            with conn.cursor() as cur:
                cur.execute("delete from tweets where tweet_id = %s", (self.tweet_id,))
                cur.execute(
                    """
                    insert into tweets (tweet_id, url, download_status)
                    values (%s, %s, 'verified')
                    """,
                    (self.tweet_id, f"https://x.com/preview_test/status/{self.tweet_id}"),
                )
                cur.execute(
                    """
                    insert into media_assets (
                      tweet_id, media_index, media_type, download_status, local_path
                    )
                    values (%s, 1, 'photo', 'verified', %s)
                    returning id
                    """,
                    (self.tweet_id, self.media_path.as_posix()),
                )
                self.media_id = int(cur.fetchone()["id"])
            conn.commit()

    def tearDown(self) -> None:
        with connect() as conn:
            with conn.cursor() as cur:
                if self.job_ids:
                    cur.execute("delete from media_preview_jobs where id = any(%s)", (self.job_ids,))
                cur.execute("delete from tweets where tweet_id = %s", (self.tweet_id,))
                cur.execute(
                    """
                    update media_preview_scheduler_settings
                    set enabled = false,
                        frequency_kind = 'daily',
                        interval_minutes = 1440,
                        local_time = '03:30:00',
                        weekday = 0,
                        timezone = 'Asia/Shanghai',
                        jitter_seconds = 0,
                        next_run_at = null,
                        last_run_at = null
                    where id = 1
                    """
                )
            conn.commit()
        self.temp_dir.cleanup()

    def test_job_generates_preview_tracks_progress_and_can_cancel_next_job(self) -> None:
        job = create_media_preview_job(mode="reconcile")
        self.job_ids.append(int(job["id"]))
        candidate = {
            "id": self.media_id,
            "local_path": self.media_path.as_posix(),
            "media_type": "photo",
            "download_status": "verified",
        }
        with (
            patch("xarchiver.services.media_previews._candidate_snapshot", return_value=(self.media_id, 1)),
            patch("xarchiver.services.media_previews._fetch_candidates", return_value=[candidate]),
        ):
            completed = process_next_media_preview_job(
                "preview-test-worker",
                SimpleNamespace(archive_dir=self.archive_dir),
            )

        assert completed is not None
        self.assertEqual(completed["status"], "completed")
        self.assertEqual(completed["scanned_count"], 1)
        self.assertEqual(completed["generated_count"], 1)
        preview_path = self.media_path.with_name("image.preview.webp")
        self.assertTrue(preview_path.is_file())
        with Image.open(preview_path) as preview:
            self.assertEqual(preview.size, (640, 427))

        queued = create_media_preview_job(mode="force")
        self.job_ids.append(int(queued["id"]))
        with self.assertRaisesRegex(ValueError, "media_preview_job_active"):
            create_media_preview_job(mode="reconcile")
        cancelled = cancel_media_preview_job(int(queued["id"]))
        assert cancelled is not None
        self.assertEqual(cancelled["status"], "cancelled")

    def test_schedule_defaults_disabled_and_calculates_next_run_when_enabled(self) -> None:
        schedule = get_media_preview_schedule()
        self.assertFalse(schedule["enabled"])

        updated = update_media_preview_schedule(
            {
                "enabled": True,
                "frequency_kind": "daily",
                "local_time": "03:30",
                "timezone": "Asia/Shanghai",
            }
        )

        self.assertTrue(updated["enabled"])
        self.assertIsNotNone(updated["next_run_at"])

    def test_list_jobs_returns_complete_history_and_total(self) -> None:
        first = create_media_preview_job(mode="force")
        first_id = int(first["id"])
        self.job_ids.append(first_id)
        cancel_media_preview_job(first_id)

        second = create_media_preview_job(mode="reconcile")
        second_id = int(second["id"])
        self.job_ids.append(second_id)
        cancel_media_preview_job(second_id)

        page = list_media_preview_jobs(limit=100)

        listed_ids = [int(job["id"]) for job in page["items"]]
        self.assertGreaterEqual(page["total"], 2)
        self.assertIn(first_id, listed_ids)
        self.assertIn(second_id, listed_ids)
        self.assertLess(listed_ids.index(second_id), listed_ids.index(first_id))


if __name__ == "__main__":
    unittest.main()
