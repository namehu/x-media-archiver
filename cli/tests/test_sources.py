import unittest
from types import SimpleNamespace
from unittest.mock import patch

from xarchiver.db import connect
from xarchiver.services.sources import (
    build_gallery_dl_scan_url,
    build_scan_range,
    count_discovered_media,
    create_source,
    discover_records_with_gallery_dl,
    extract_gallery_dl_cursor,
    format_sleep_range,
    infer_author_username,
    is_media_scan_url,
    is_source_scan_complete,
    merge_discovery_payload,
    normalize_source_type,
    normalize_source_url,
    parse_gallery_dl_records,
    record_source_discoveries,
    scan_source,
    scan_run_status,
    schedule_next_history_scan,
)


class SourceServiceTests(unittest.TestCase):
    def test_normalize_source_type_rejects_unknown_type(self) -> None:
        with self.assertRaisesRegex(ValueError, "invalid_source_type"):
            normalize_source_type("timeline")

    def test_normalize_source_url_rejects_non_x_url(self) -> None:
        with self.assertRaisesRegex(ValueError, "invalid_source_url"):
            normalize_source_url("https://example.com/user")

    def test_infer_author_username_for_media_url(self) -> None:
        self.assertEqual(
            infer_author_username("user_media", "https://x.com/example/media"),
            "example",
        )

    def test_infer_author_username_ignores_non_profile_sources(self) -> None:
        self.assertIsNone(infer_author_username("search", "https://x.com/search?q=test"))

    def test_parse_gallery_dl_records_extracts_unique_tweets(self) -> None:
        stdout = """
        [
          [2, {"tweet_id": 123, "content": "hello", "date": "2026-05-27 01:02:03",
               "author": {"name": "alice", "nick": "Alice"}}],
          [3, "https://pbs.twimg.com/media/test.jpg", {"tweet_id": 123,
               "author": {"name": "alice", "nick": "Alice"}, "type": "photo"}],
          [3, "https://video.twimg.com/ext_tw_video/test.mp4", {"tweet_id": 123,
               "author": {"name": "alice", "nick": "Alice"}, "type": "video"}],
          [2, {"tweet_id": 456, "author": {"name": "bob"}}],
          [3, "https://pbs.twimg.com/media/other.jpg", {"tweet_id": 456,
               "author": {"name": "bob"}, "type": "photo"}]
        ]
        """

        rows = parse_gallery_dl_records(stdout, "https://x.com/alice/media")

        self.assertEqual([row["tweet_id"] for row in rows], ["123", "456"])
        self.assertEqual(rows[0]["url"], "https://x.com/alice/status/123")
        self.assertEqual(rows[0]["text"], "hello")
        self.assertIn("collected_at", rows[0])
        self.assertEqual(rows[0]["media_count"], 2)
        self.assertEqual(rows[0]["media_types"], ["photo", "video"])
        self.assertTrue(rows[0]["has_photo"])
        self.assertTrue(rows[0]["has_video"])
        self.assertEqual(rows[1]["media_count"], 1)

    def test_media_scan_excludes_page_metadata_outside_requested_media_range(self) -> None:
        stdout = """
        [
          [2, {"tweet_id": 123, "content": "selected", "author": {"name": "alice"}}],
          [3, "https://pbs.twimg.com/media/selected.jpg", {"tweet_id": 123,
               "author": {"name": "alice"}, "type": "photo"}],
          [2, {"tweet_id": 456, "content": "page metadata only", "author": {"name": "alice"}}]
        ]
        """

        rows = parse_gallery_dl_records(stdout, "https://x.com/alice/media")

        self.assertEqual([row["tweet_id"] for row in rows], ["123"])

    def test_timeline_scan_can_retain_non_media_tweet_metadata(self) -> None:
        rows = parse_gallery_dl_records(
            '[[2, {"tweet_id": 456, "content": "plain tweet", "author": {"name": "alice"}}]]',
            "https://x.com/alice/timeline",
        )

        self.assertEqual([row["tweet_id"] for row in rows], ["456"])
        self.assertTrue(is_media_scan_url("https://x.com/alice/media"))

    def test_build_gallery_dl_scan_url_uses_timeline_for_profile(self) -> None:
        self.assertEqual(
            build_gallery_dl_scan_url("profile", "https://x.com/earthcurated"),
            "https://x.com/earthcurated/timeline",
        )

    def test_build_scan_range_advances_from_cursor(self) -> None:
        self.assertEqual(
            build_scan_range({"next_start_index": 21}, 20),
            {"start": 21, "end": 40, "limit": 20},
        )

    def test_build_scan_range_can_restart_from_latest(self) -> None:
        self.assertEqual(
            build_scan_range({"next_start_index": 101}, 10, restart=True),
            {"start": 1, "end": 10, "limit": 10},
        )

    def test_native_cursor_completion_requires_no_continuation_cursor(self) -> None:
        self.assertFalse(
            is_source_scan_complete(
                {"exit_code": 0, "continuation_cursor": "next"},
                {"limit": 20},
                13,
            )
        )
        self.assertTrue(
            is_source_scan_complete(
                {"exit_code": 0, "continuation_cursor": None},
                {"limit": 20},
                13,
            )
        )
        self.assertFalse(is_source_scan_complete({"exit_code": 1, "continuation_cursor": None}, {"limit": 20}, 0))

    def test_extract_gallery_dl_cursor_uses_last_page_cursor(self) -> None:
        stderr = "[twitter][debug] Cursor: first\n[twitter][debug] Cursor: second\n"
        self.assertEqual(extract_gallery_dl_cursor(stderr), "second")

    def test_format_sleep_range_normalizes_values(self) -> None:
        self.assertEqual(format_sleep_range(20, 45), "20-45")
        self.assertEqual(format_sleep_range(45, 20), "20-45")

    def test_discover_records_uses_native_cursor_command(self) -> None:
        completed = SimpleNamespace(
            returncode=0,
            stdout='[[2, {"tweet_id": 123, "content": "hello", "author": {"name": "alice"}}]]',
            stderr="[twitter][debug] Cursor: next-cursor\n",
        )
        with (
            patch("xarchiver.services.sources.shutil.which", return_value="/usr/bin/gallery-dl"),
            patch("xarchiver.services.sources.subprocess.run", return_value=completed) as run,
        ):
            rows, meta = discover_records_with_gallery_dl(
                "https://x.com/alice/timeline",
                21,
                40,
                2,
                6,
                continuation_cursor="old-cursor",
            )

        command = run.call_args.args[0]
        self.assertIn("--post-range", command)
        self.assertIn("1-20", command)
        self.assertIn("-o", command)
        self.assertIn("cursor=old-cursor", command)
        self.assertNotIn("--range", command)
        self.assertEqual(rows[0]["tweet_id"], "123")
        self.assertEqual(meta["cursor_mode"], "native")
        self.assertEqual(meta["continuation_cursor"], "next-cursor")

    def test_merge_discovery_payload_retains_media_across_ranges(self) -> None:
        merged = merge_discovery_payload(
            {"media_items": [{"type": "photo", "url": "photo-1"}]},
            {"media_items": [{"type": "photo", "url": "photo-2"}], "tweet_id": "123"},
        )

        self.assertEqual(merged["media_count"], 2)
        self.assertEqual(merged["media_types"], ["photo"])

    def test_scan_run_status_classifies_visible_results(self) -> None:
        self.assertEqual(scan_run_status({"exit_code": 0}, False), "succeeded")
        self.assertEqual(scan_run_status({"exit_code": 0, "raw_record_count": 0}, True), "completed_empty_batch")
        self.assertEqual(scan_run_status({"exit_code": 0, "raw_record_count": 13}, True), "completed_end_of_source")
        self.assertEqual(scan_run_status({"error_category": "rate_limited"}, False), "rate_limited")
        self.assertEqual(scan_run_status({"error_category": "network_error"}, False), "network_error")
        self.assertEqual(scan_run_status({"error_category": "command_not_found"}, False), "failed")

    def test_count_discovered_media_sums_batch_estimates(self) -> None:
        self.assertEqual(count_discovered_media([{"media_count": 2}, {"media_count": 1}, {}]), 3)

    def test_latest_refresh_empty_batch_does_not_advance_or_complete_history_cursor(self) -> None:
        cursor = {"next_start_index": 81, "last_completed": False}
        settings = SimpleNamespace(source_scan_sleep_min_seconds=20, source_scan_sleep_max_seconds=45)
        with (
            patch(
                "xarchiver.services.sources.get_source",
                return_value={
                    "status": "active",
                    "source_type": "user_media",
                    "source_url": "https://x.com/example/media",
                    "cursor_state": cursor,
                },
            ),
            patch("xarchiver.services.sources.start_source_scan_run", return_value=7),
            patch(
                "xarchiver.services.sources.discover_records_with_gallery_dl",
                return_value=(
                    [],
                    {
                        "exit_code": 0,
                        "scan_url": "https://x.com/example/media",
                        "cursor_mode": "native",
                        "continuation_cursor": None,
                    },
                ),
            ),
            patch("xarchiver.services.sources.update_source_cursor") as update_cursor,
            patch("xarchiver.services.sources.mark_source_scan_result"),
            patch("xarchiver.services.sources.finish_source_scan_run") as finish_run,
        ):
            result = scan_source(1, 20, restart=True, settings=settings)

        self.assertFalse(result["completed"])
        update_cursor.assert_not_called()
        finish_run.assert_called_once_with(
            7,
            "succeeded",
            cursor_after=cursor,
            error_category=None,
            error_message=None,
        )

    def test_schedule_next_history_scan_does_not_reschedule_paused_source(self) -> None:
        settings = SimpleNamespace(source_scan_sleep_min_seconds=20, source_scan_sleep_max_seconds=45)
        with (
            patch(
                "xarchiver.services.sources.get_source",
                return_value={
                    "status": "paused",
                    "cursor_state": {"automation_enabled": True},
                },
            ),
            patch("xarchiver.services.sources.update_history_scan_state") as update_state,
        ):
            schedule_next_history_scan(1, settings, "running")

        update_state.assert_not_called()


class SourceDiscoveryIntegrationTests(unittest.TestCase):
    tweet_id = "919900000000000001"

    def setUp(self) -> None:
        self.cleanup_db()

    def tearDown(self) -> None:
        self.cleanup_db()

    def cleanup_db(self) -> None:
        with connect() as conn:
            with conn.cursor() as cur:
                cur.execute("delete from archive_sources where source_url = %s", ("https://x.com/sourcefixture/media",))
                cur.execute("delete from tweets where tweet_id = %s", (self.tweet_id,))
            conn.commit()

    def test_repeated_discovery_preserves_first_discovered_at(self) -> None:
        source = create_source("user_media", "https://x.com/sourcefixture/media")
        first = {
            "tweet_id": self.tweet_id,
            "url": f"https://x.com/sourcefixture/status/{self.tweet_id}",
            "author_username": "sourcefixture",
            "author_display_name": None,
            "text": "first",
            "published_at": None,
            "collected_at": None,
            "raw_import": {},
        }
        second = {
            "tweet_id": self.tweet_id,
            "url": f"https://x.com/sourcefixture/status/{self.tweet_id}",
            "author_username": "sourcefixture",
            "author_display_name": None,
            "text": "second",
            "published_at": None,
            "collected_at": None,
            "raw_import": {},
        }

        first_result = record_source_discoveries(int(source["id"]), [first])
        with connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    update source_discovered_tweets
                    set discovered_at = '2026-01-01 00:00:00+00'
                    where source_id = %s and tweet_id = %s
                    """,
                    (source["id"], self.tweet_id),
                )
            conn.commit()

        second_result = record_source_discoveries(int(source["id"]), [second])

        with connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    select discovered_at, raw_payload->>'text' as text
                    from source_discovered_tweets
                    where source_id = %s and tweet_id = %s
                    """,
                    (source["id"], self.tweet_id),
                )
                row = cur.fetchone()

        self.assertEqual(first_result["new_discovered_count"], 1)
        self.assertEqual(second_result["new_discovered_count"], 0)
        self.assertEqual(second_result["duplicate_count"], 1)
        self.assertEqual(row["discovered_at"].isoformat(), "2026-01-01T00:00:00+00:00")
        self.assertEqual(row["text"], "second")

if __name__ == "__main__":
    unittest.main()
