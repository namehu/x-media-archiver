import unittest
from types import SimpleNamespace
from unittest.mock import patch

from psycopg.types.json import Jsonb

from xarchiver.db import connect
from xarchiver.downloader import (
    mark_run_items_progress,
    mark_run_items_tweet_progress,
)
from xarchiver.services.queue import claim_next_items
from xarchiver.services.sources import (
    build_active_scan_range,
    build_gallery_dl_scan_url,
    build_scan_range,
    count_discovered_media,
    create_source,
    delete_source,
    detect_gallery_dl_exhausted_retry,
    discover_records_with_gallery_dl,
    extract_gallery_dl_cursor,
    format_sleep_range,
    get_source,
    get_source_downloads,
    infer_author_username,
    is_media_scan_url,
    is_scan_session_complete,
    is_source_scan_complete,
    list_source_discovered_page,
    list_source_scan_runs_page,
    list_sources_page,
    merge_discovery_payload,
    normalize_source_type,
    normalize_source_url,
    parse_gallery_dl_records,
    record_source_discoveries,
    recover_expired_source_scan_leases,
    scan_run_status,
    scan_source,
    schedule_next_history_scan,
    source_scan_log_relative_path,
    start_source_scan_run,
    start_source_scan_session,
    stop_source_scan_session,
    submit_source_downloads,
    update_session_progress_state,
    update_source_pin,
)


class SourceServiceTests(unittest.TestCase):
    def test_normalize_source_type_rejects_unknown_type(self) -> None:
        with self.assertRaisesRegex(ValueError, "invalid_source_type"):
            normalize_source_type("timeline")

    def test_normalize_source_url_rejects_non_x_url(self) -> None:
        with self.assertRaisesRegex(ValueError, "invalid_source_url"):
            normalize_source_url("https://example.com/user")

    def test_normalize_source_url_canonicalizes_equivalent_x_hosts(self) -> None:
        self.assertEqual(
            normalize_source_url(" http://www.twitter.com/example/media/#top "),
            "https://x.com/example/media",
        )

    def test_normalize_source_url_preserves_query(self) -> None:
        self.assertEqual(
            normalize_source_url("https://twitter.com/search?q=from%3Aexample/"),
            "https://x.com/search?q=from%3Aexample/",
        )

    def test_infer_author_username_for_media_url(self) -> None:
        self.assertEqual(
            infer_author_username("user_media", "https://x.com/example/media"),
            "example",
        )

    def test_infer_author_username_for_likes_url(self) -> None:
        self.assertEqual(
            infer_author_username("likes", "https://x.com/example/likes"),
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

    def test_build_gallery_dl_scan_url_keeps_likes_url(self) -> None:
        self.assertEqual(
            build_gallery_dl_scan_url("likes", "https://x.com/XiangHupt/likes"),
            "https://x.com/XiangHupt/likes",
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

    def test_build_active_scan_range_uses_active_session_cursor(self) -> None:
        cursor_state = {
            "next_start_index": 81,
            "active_scan_mode": "latest_refresh",
            "scan_sessions": {
                "latest_refresh": {"next_start_index": 21},
            },
        }

        self.assertEqual(
            build_active_scan_range(cursor_state, 20),
            {"start": 21, "end": 40, "limit": 20},
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
        self.assertFalse(
            is_source_scan_complete(
                {"exit_code": 0, "error_category": "network_error", "continuation_cursor": None},
                {"limit": 20},
                0,
            )
        )

    def test_extract_gallery_dl_cursor_uses_last_page_cursor(self) -> None:
        stderr = "[twitter][debug] Cursor: first\n[twitter][debug] Cursor: second\n"
        self.assertEqual(extract_gallery_dl_cursor(stderr), "second")

    def test_extract_gallery_dl_cursor_ignores_none_sentinel(self) -> None:
        stderr = "[twitter][debug] Cursor: first\n[twitter][debug] Cursor: None\n"
        self.assertIsNone(extract_gallery_dl_cursor(stderr))

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
        self.assertIn("--http-timeout", command)
        self.assertIn("15", command)
        self.assertIn("--retries", command)
        self.assertIn("2", command)
        self.assertIn("-o", command)
        self.assertIn("cursor=old-cursor", command)
        self.assertNotIn("--range", command)
        self.assertEqual(rows[0]["tweet_id"], "123")
        self.assertEqual(meta["cursor_mode"], "native")
        self.assertEqual(meta["continuation_cursor"], "next-cursor")

    def test_discover_records_treats_exhausted_timeout_as_failure_even_with_zero_exit(self) -> None:
        completed = SimpleNamespace(
            returncode=0,
            stdout='[[2, {"tweet_id": 123, "author": {"name": "alice"}}]]',
            stderr=(
                "[twitter][debug] HTTPSConnectionPool(host='x.com', port=443): "
                "Read timed out. (read timeout=15) (3/3)\n"
            ),
        )
        with (
            patch("xarchiver.services.sources.shutil.which", return_value="/usr/bin/gallery-dl"),
            patch("xarchiver.services.sources.subprocess.run", return_value=completed),
        ):
            rows, meta = discover_records_with_gallery_dl("https://x.com/alice/media", 1, 20)

        self.assertEqual(rows, [])
        self.assertEqual(meta["exit_code"], 0)
        self.assertEqual(meta["error_category"], "network_error")
        self.assertIn("(3/3)", str(meta["error_message"]))

    def test_detect_gallery_dl_exhausted_retry_classifies_ssl_eof(self) -> None:
        detected = detect_gallery_dl_exhausted_retry(
            "[twitter][debug] SSLError: UNEXPECTED_EOF_WHILE_READING (3/3)\n"
        )
        self.assertEqual(detected, ("network_error", "[twitter][debug] SSLError: UNEXPECTED_EOF_WHILE_READING (3/3)"))

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
        self.assertEqual(scan_run_status({"exit_code": 0, "error_category": "network_error"}, True), "network_error")
        self.assertEqual(scan_run_status({"error_category": "command_not_found"}, False), "failed")

    def test_count_discovered_media_sums_batch_estimates(self) -> None:
        self.assertEqual(count_discovered_media([{"media_count": 2}, {"media_count": 1}, {}]), 3)

    def test_latest_refresh_completes_only_after_duplicate_threshold(self) -> None:
        meta = {"exit_code": 0, "continuation_cursor": "next"}
        scan_range = {"start": 1, "end": 20, "limit": 20}

        self.assertFalse(is_scan_session_complete("latest_refresh", meta, scan_range, 20, 5))
        self.assertTrue(is_scan_session_complete("latest_refresh", meta, scan_range, 20, 6))

    def test_from_start_duplicate_batch_does_not_complete_session(self) -> None:
        self.assertFalse(
            is_scan_session_complete(
                "from_start",
                {"exit_code": 0, "continuation_cursor": "next"},
                {"start": 1, "end": 20, "limit": 20},
                20,
                20,
            )
        )

    def test_non_history_session_progress_does_not_overwrite_history_cursor(self) -> None:
        state = {
            "next_start_index": 81,
            "extractor_cursor": "history-cursor",
            "scan_sessions": {
                "latest_refresh": {"next_start_index": 1},
            },
        }
        progress = {
            "next_start_index": 21,
            "extractor_cursor": "latest-cursor",
            "last_range_start": 1,
            "last_range_end": 20,
            "last_limit": 20,
            "last_completed": False,
        }

        updated = update_session_progress_state(state, "latest_refresh", progress, False)

        self.assertEqual(updated["scan_sessions"]["latest_refresh"]["next_start_index"], 21)
        self.assertEqual(updated["scan_sessions"]["latest_refresh"]["extractor_cursor"], "latest-cursor")
        self.assertNotIn("next_start_index", updated)
        self.assertNotIn("extractor_cursor", updated)

    def test_source_scan_log_relative_path_uses_jsonl_stream_file(self) -> None:
        self.assertEqual(
            source_scan_log_relative_path(18, 42),
            "logs/source-scan-logs/source-18/scan-run-42.jsonl",
        )

    def test_latest_refresh_empty_batch_does_not_advance_or_complete_history_cursor(self) -> None:
        cursor = {"next_start_index": 81, "last_completed": False}
        settings = SimpleNamespace(
            source_scan_sleep_min_seconds=2,
            source_scan_sleep_max_seconds=6,
            source_scan_http_timeout_seconds=15,
            source_scan_http_retries=2,
        )
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
            patch("xarchiver.services.sources.prepare_cookies", return_value=None),
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
            worker_id=None,
        )

    def test_zero_exit_network_error_does_not_advance_cursor(self) -> None:
        cursor = {"next_start_index": 21, "last_completed": False}
        settings = SimpleNamespace(
            source_scan_sleep_min_seconds=2,
            source_scan_sleep_max_seconds=6,
            source_scan_http_timeout_seconds=15,
            source_scan_http_retries=2,
        )
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
            patch("xarchiver.services.sources.start_source_scan_run", return_value=9),
            patch(
                "xarchiver.services.sources.discover_records_with_gallery_dl",
                return_value=(
                    [],
                    {
                        "exit_code": 0,
                        "error_category": "network_error",
                        "error_message": "Read timed out. (3/3)",
                    },
                ),
            ),
            patch("xarchiver.services.sources.prepare_cookies", return_value=None),
            patch("xarchiver.services.sources.update_source_cursor") as update_cursor,
            patch("xarchiver.services.sources.mark_source_scan_result") as mark_result,
            patch("xarchiver.services.sources.finish_source_scan_run") as finish_run,
        ):
            result = scan_source(1, 20, settings=settings, session_mode="history")

        self.assertFalse(result["completed"])
        update_cursor.assert_not_called()
        mark_result.assert_called_once_with(
            1,
            error_category="network_error",
            error_message="Read timed out. (3/3)",
        )
        finish_run.assert_called_once_with(
            9,
            "network_error",
            cursor_after=cursor,
            error_category="network_error",
            error_message="Read timed out. (3/3)",
            worker_id=None,
        )

    def test_likes_source_scan_is_supported(self) -> None:
        settings = SimpleNamespace(
            source_scan_sleep_min_seconds=2,
            source_scan_sleep_max_seconds=6,
            source_scan_http_timeout_seconds=15,
            source_scan_http_retries=2,
        )
        with (
            patch(
                "xarchiver.services.sources.get_source",
                return_value={
                    "status": "active",
                    "source_type": "likes",
                    "source_url": "https://x.com/XiangHupt/likes",
                    "cursor_state": {},
                },
            ),
            patch("xarchiver.services.sources.start_source_scan_run", return_value=8),
            patch(
                "xarchiver.services.sources.discover_records_with_gallery_dl",
                return_value=(
                    [],
                    {
                        "exit_code": 0,
                        "scan_url": "https://x.com/XiangHupt/likes",
                        "cursor_mode": "native",
                        "continuation_cursor": None,
                    },
                ),
            ) as discover,
            patch("xarchiver.services.sources.prepare_cookies", return_value=None),
            patch("xarchiver.services.sources.update_source_cursor") as update_cursor,
            patch("xarchiver.services.sources.mark_source_scan_result"),
            patch("xarchiver.services.sources.finish_source_scan_run"),
        ):
            result = scan_source(32, 20, restart=True, settings=settings)

        self.assertFalse(result["completed"])
        self.assertEqual(discover.call_args.args[0], "https://x.com/XiangHupt/likes")
        update_cursor.assert_not_called()

    def test_schedule_next_history_scan_does_not_reschedule_paused_source(self) -> None:
        settings = SimpleNamespace(source_scan_sleep_min_seconds=2, source_scan_sleep_max_seconds=6)
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
    tweet_ids = ["919900000000000001", "919900000000000002"]
    source_urls = [
        "https://x.com/sourcefixture/media",
        "https://x.com/sourcefixture2/media",
        "https://x.com/sourcefixture3",
        "https://x.com/sourcefixture/likes",
    ]

    def setUp(self) -> None:
        self.cleanup_db()

    def tearDown(self) -> None:
        self.cleanup_db()

    def cleanup_db(self) -> None:
        with connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    delete from download_jobs
                    where archive_run_id in (
                        select distinct archive_run_id
                        from archive_run_items
                        where tweet_id = any(%s)
                    )
                    """,
                    (self.tweet_ids,),
                )
                cur.execute(
                    """
                    delete from archive_runs
                    where exists (
                        select 1
                        from archive_run_items
                        where archive_run_id = archive_runs.id
                          and tweet_id = any(%s)
                    )
                    """,
                    (self.tweet_ids,),
                )
                cur.execute("delete from archive_sources where source_url = any(%s)", (self.source_urls,))
                cur.execute("delete from tweets where tweet_id = any(%s)", (self.tweet_ids,))
            conn.commit()

    def test_start_source_scan_run_creates_operation_log_stream(self) -> None:
        source = create_source("profile", self.source_urls[2])
        scan_range = {"start": 1, "end": 5, "limit": 5}

        scan_run_id = start_source_scan_run(
            int(source["id"]),
            "manual_next",
            scan_range,
            {},
            worker_id="worker-test",
        )

        with connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    select r.log_stream_id, l.scope_type, l.scope_id, l.log_path, l.metadata
                    from source_scan_runs r
                    join operation_log_streams l on l.id = r.log_stream_id
                    where r.id = %s
                    """,
                    (scan_run_id,),
                )
                row = cur.fetchone()

        self.assertIsNotNone(row["log_stream_id"])
        self.assertEqual(row["scope_type"], "source_scan")
        self.assertEqual(row["scope_id"], scan_run_id)
        self.assertEqual(row["log_path"], source_scan_log_relative_path(int(source["id"]), scan_run_id))
        self.assertEqual(row["metadata"]["source_id"], int(source["id"]))

    def test_create_source_rejects_duplicate_normalized_url(self) -> None:
        source = create_source("user_media", "http://twitter.com/sourcefixture/media/")

        self.assertEqual(source["source_url"], self.source_urls[0])
        with self.assertRaisesRegex(ValueError, "source_already_exists"):
            create_source("user_media", "https://x.com/sourcefixture/media")

    def test_delete_source_soft_deletes_without_removing_history(self) -> None:
        source = create_source("user_media", self.source_urls[0])
        record_source_discoveries(
            int(source["id"]),
            [
                {
                    "tweet_id": self.tweet_id,
                    "url": f"https://x.com/sourcefixture/status/{self.tweet_id}",
                    "author_username": "sourcefixture",
                    "author_display_name": None,
                    "text": None,
                    "published_at": None,
                    "collected_at": None,
                    "raw_import": {"media_count": 1},
                }
            ],
        )
        scan_run_id = start_source_scan_run(
            int(source["id"]),
            "manual_next",
            {"start": 1, "end": 20, "limit": 20},
            {},
            worker_id="worker-test",
        )
        submitted = submit_source_downloads(int(source["id"]), "all_unsubmitted")
        with connect() as conn:
            with conn.cursor() as cur:
                cur.execute("update source_scan_runs set status = 'succeeded', finished_at = now() where id = %s", (scan_run_id,))
                cur.execute("update archive_runs set status = 'completed', finished_at = now() where id = %s", (submitted["run_id"],))
            conn.commit()

        result = delete_source(int(source["id"]), confirm_delete=True)

        self.assertEqual(result["source_id"], source["id"])
        self.assertIsNone(get_source(int(source["id"])))
        deleted_detail = get_source(int(source["id"]), include_deleted=True)
        self.assertIsNotNone(deleted_detail)
        self.assertEqual(deleted_detail["id"], source["id"])
        page = list_sources_page(limit=20)
        self.assertNotIn(source["id"], [row["id"] for row in page["rows"]])
        deleted_page = list_sources_page(deleted="deleted", limit=20)
        self.assertIn(source["id"], [row["id"] for row in deleted_page["rows"]])
        all_page = list_sources_page(deleted="all", limit=20)
        self.assertIn(source["id"], [row["id"] for row in all_page["rows"]])
        with self.assertRaisesRegex(ValueError, "source_not_found"):
            list_source_discovered_page(int(source["id"]))
        discovered_page = list_source_discovered_page(int(source["id"]), include_deleted=True)
        scan_runs_page = list_source_scan_runs_page(int(source["id"]), include_deleted=True)
        downloads = get_source_downloads(int(source["id"]), include_deleted=True)
        self.assertEqual(discovered_page["total_count"], 1)
        self.assertEqual(scan_runs_page["total_count"], 1)
        self.assertEqual(downloads["source_id"], source["id"])
        with connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "select status, is_pinned, next_scan_at, deleted_at from archive_sources where id = %s",
                    (source["id"],),
                )
                source_row = cur.fetchone()
                cur.execute("select count(*)::int as count from source_discovered_tweets where source_id = %s", (source["id"],))
                discovered_count = int(cur.fetchone()["count"])
                cur.execute("select count(*)::int as count from source_scan_runs where source_id = %s", (source["id"],))
                scan_count = int(cur.fetchone()["count"])
                cur.execute("select count(*)::int as count from archive_runs where source_id = %s", (source["id"],))
                run_count = int(cur.fetchone()["count"])

        self.assertEqual(source_row["status"], "paused")
        self.assertFalse(source_row["is_pinned"])
        self.assertIsNone(source_row["next_scan_at"])
        self.assertIsNotNone(source_row["deleted_at"])
        self.assertEqual(discovered_count, 1)
        self.assertEqual(scan_count, 1)
        self.assertEqual(run_count, 1)

    def test_list_sources_page_rejects_invalid_deleted_filter(self) -> None:
        with self.assertRaisesRegex(ValueError, "invalid_source_deleted_filter"):
            list_sources_page(deleted="archived")

    def test_create_source_restores_soft_deleted_source(self) -> None:
        source = create_source("user_media", self.source_urls[0], label="旧来源")
        delete_source(int(source["id"]), confirm_delete=True)

        restored = create_source("user_media", "https://x.com/sourcefixture/media", label="恢复来源")

        self.assertEqual(restored["id"], source["id"])
        self.assertEqual(restored["label"], "恢复来源")
        self.assertEqual(restored["status"], "active")
        self.assertIsNone(restored["deleted_at"])
        self.assertIsNotNone(get_source(int(source["id"])))

    def test_delete_source_rejects_unconfirmed_request(self) -> None:
        source = create_source("user_media", self.source_urls[0])

        with self.assertRaisesRegex(ValueError, "source_delete_confirmation_required"):
            delete_source(int(source["id"]))

    def test_delete_source_rejects_active_scan(self) -> None:
        source = create_source("profile", self.source_urls[2])
        start_source_scan_run(
            int(source["id"]),
            "manual_next",
            {"start": 1, "end": 20, "limit": 20},
            {},
            worker_id="worker-test",
        )

        with self.assertRaisesRegex(ValueError, "source_delete_active_work"):
            delete_source(int(source["id"]), confirm_delete=True)

    def test_delete_source_rejects_active_download_run(self) -> None:
        source = create_source("user_media", self.source_urls[0])
        record_source_discoveries(
            int(source["id"]),
            [
                {
                    "tweet_id": self.tweet_id,
                    "url": f"https://x.com/sourcefixture/status/{self.tweet_id}",
                    "author_username": "sourcefixture",
                    "author_display_name": None,
                    "text": None,
                    "published_at": None,
                    "collected_at": None,
                    "raw_import": {"media_count": 1},
                }
            ],
        )
        submit_source_downloads(int(source["id"]), "all_unsubmitted")

        with self.assertRaisesRegex(ValueError, "source_delete_active_work"):
            delete_source(int(source["id"]), confirm_delete=True)

    def test_delete_source_rejects_stopped_run_with_processing_item(self) -> None:
        source = create_source("user_media", self.source_urls[0])
        record_source_discoveries(
            int(source["id"]),
            [
                {
                    "tweet_id": self.tweet_id,
                    "url": f"https://x.com/sourcefixture/status/{self.tweet_id}",
                    "author_username": "sourcefixture",
                    "author_display_name": None,
                    "text": None,
                    "published_at": None,
                    "collected_at": None,
                    "raw_import": {"media_count": 1},
                }
            ],
        )
        submitted = submit_source_downloads(int(source["id"]), "all_unsubmitted")
        with connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "update archive_runs set status = 'stopped' where id = %s",
                    (submitted["run_id"],),
                )
                cur.execute(
                    """
                    update archive_run_items
                    set status = 'processing',
                        cancel_requested = true
                    where archive_run_id = %s
                    """,
                    (submitted["run_id"],),
                )
            conn.commit()

        with self.assertRaisesRegex(ValueError, "source_delete_active_work"):
            delete_source(int(source["id"]), confirm_delete=True)

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

    def test_list_sources_page_supports_filters_offset_and_total_count(self) -> None:
        baseline = list_sources_page(status="paused", source_type="user_media", limit=1, offset=0)["total_count"]
        first = create_source("user_media", self.source_urls[0])
        second = create_source("user_media", self.source_urls[1])
        create_source("profile", self.source_urls[2])
        with connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "update archive_sources set status = 'paused', updated_at = '2099-01-01 00:00:00+00' where id = %s",
                    (first["id"],),
                )
                cur.execute(
                    "update archive_sources set status = 'paused', updated_at = '2099-01-02 00:00:00+00' where id = %s",
                    (second["id"],),
                )
            conn.commit()

        page = list_sources_page(status="paused", source_type="user_media", limit=1, offset=1)

        self.assertEqual(page["count"], 1)
        self.assertEqual(page["total_count"], baseline + 2)
        self.assertEqual(page["limit"], 1)
        self.assertEqual(page["offset"], 1)
        self.assertEqual([row["id"] for row in page["rows"]], [first["id"]])

    def test_sources_sorting_keeps_pinned_items_first_and_is_stable(self) -> None:
        first = create_source("user_media", self.source_urls[0])
        second = create_source("user_media", self.source_urls[1])
        third = create_source("user_media", self.source_urls[2])
        with connect() as conn:
            with conn.cursor() as cur:
                cur.execute("update archive_sources set created_at = '2099-01-01 00:00:00+00' where id = %s", (first["id"],))
                cur.execute("update archive_sources set created_at = '2099-01-02 00:00:00+00' where id = %s", (second["id"],))
                cur.execute("update archive_sources set created_at = '2099-01-03 00:00:00+00' where id = %s", (third["id"],))
            conn.commit()

        update_source_pin(int(first["id"]), True)
        descending = list_sources_page(sort_by="created_at", sort_direction="desc", limit=10)
        ascending = list_sources_page(sort_by="created_at", sort_direction="asc", limit=10)

        source_ids = {first["id"], second["id"], third["id"]}
        descending_ids = [row["id"] for row in descending["rows"] if row["id"] in source_ids]
        ascending_ids = [row["id"] for row in ascending["rows"] if row["id"] in source_ids]
        self.assertEqual(descending_ids, [first["id"], third["id"], second["id"]])
        self.assertEqual(ascending_ids, [first["id"], second["id"], third["id"]])

        updated = update_source_pin(int(first["id"]), False)
        self.assertFalse(updated["is_pinned"])
        with self.assertRaisesRegex(ValueError, "source_not_found"):
            update_source_pin(999999999, True)

    def test_source_detail_is_slim_and_exposes_active_scan_run(self) -> None:
        source = create_source("profile", self.source_urls[2])
        running_id = start_source_scan_run(
            int(source["id"]),
            "history_worker",
            {"start": 1, "end": 20, "limit": 20},
            {},
            worker_id="worker-test",
        )

        detail = get_source(int(source["id"]))

        self.assertIsNotNone(detail)
        assert detail is not None
        self.assertIn("scan_summary", detail)
        self.assertIn("active_scan_run", detail)
        self.assertEqual(detail["active_scan_run"]["id"], running_id)
        self.assertNotIn("discovered", detail)
        self.assertNotIn("scan_runs", detail)

    def test_stop_paused_scan_session_leaves_source_operable(self) -> None:
        source = create_source("user_media", self.source_urls[0])
        with connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    update archive_sources
                    set status = 'paused',
                        cursor_state = %s
                    where id = %s
                    """,
                    (
                        Jsonb(
                            {
                                "active_scan_mode": "from_start",
                                "automation_enabled": True,
                                "automation_state": "paused",
                                "scan_sessions": {
                                    "from_start": {
                                        "mode": "from_start",
                                        "state": "paused",
                                        "next_start_index": 41,
                                    }
                                },
                            }
                        ),
                        source["id"],
                    ),
                )
            conn.commit()

        stopped = stop_source_scan_session(int(source["id"]))

        self.assertEqual(stopped["status"], "active")
        self.assertFalse(stopped["cursor_state"]["automation_enabled"])
        self.assertEqual(stopped["cursor_state"]["automation_state"], "stopped")
        self.assertEqual(stopped["cursor_state"]["scan_sessions"]["from_start"]["state"], "stopped")

    def test_start_scan_session_accepts_likes_source(self) -> None:
        source = create_source("likes", "https://x.com/sourcefixture/likes")

        started = start_source_scan_session(int(source["id"]), "latest_refresh", limit=20, restart=True)

        self.assertEqual(started["source_type"], "likes")
        self.assertEqual(started["cursor_state"]["active_scan_mode"], "latest_refresh")
        self.assertTrue(started["cursor_state"]["automation_enabled"])

    def test_list_source_discovered_page_supports_pagination(self) -> None:
        source = create_source("user_media", self.source_urls[0])
        records = [
            {
                "tweet_id": tweet_id,
                "url": f"https://x.com/sourcefixture/status/{tweet_id}",
                "author_username": "sourcefixture",
                "author_display_name": None,
                "text": f"tweet {index}",
                "published_at": None,
                "collected_at": None,
                "raw_import": {"media_count": index},
            }
            for index, tweet_id in enumerate(self.tweet_ids, start=1)
        ]
        record_source_discoveries(int(source["id"]), records)

        page = list_source_discovered_page(int(source["id"]), limit=1, offset=1)

        self.assertEqual(page["count"], 1)
        self.assertEqual(page["total_count"], 2)
        self.assertEqual(page["limit"], 1)
        self.assertEqual(page["offset"], 1)
        self.assertEqual(page["rows"][0]["tweet_id"], self.tweet_ids[0])

    def test_source_download_queues_and_claims_tweets_in_visible_order(self) -> None:
        source = create_source("user_media", self.source_urls[0])
        record_source_discoveries(
            int(source["id"]),
            [
                {
                    "tweet_id": tweet_id,
                    "url": f"https://x.com/sourcefixture/status/{tweet_id}",
                    "author_username": "sourcefixture",
                    "author_display_name": None,
                    "text": None,
                    "published_at": None,
                    "collected_at": None,
                    "raw_import": {"media_count": 1},
                }
                for tweet_id in self.tweet_ids
            ],
        )
        with connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "update source_discovered_tweets set discovered_at = %s where source_id = %s and tweet_id = %s",
                    ("2026-01-01T00:00:00+00:00", int(source["id"]), self.tweet_ids[0]),
                )
                cur.execute(
                    "update source_discovered_tweets set discovered_at = %s where source_id = %s and tweet_id = %s",
                    ("2026-01-02T00:00:00+00:00", int(source["id"]), self.tweet_ids[1]),
                )
            conn.commit()

        submitted = submit_source_downloads(int(source["id"]), "all_unsubmitted")
        with connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "select tweet_id from archive_run_items where archive_run_id = %s order by id",
                    (submitted["run_id"],),
                )
                queued_tweet_ids = [str(row["tweet_id"]) for row in cur.fetchall()]

        claimed = claim_next_items(3, batch_size=1, worker_id="source-order-test")

        self.assertEqual(queued_tweet_ids, [self.tweet_ids[1], self.tweet_ids[0]])
        self.assertEqual([str(item["tweet_id"]) for item in claimed], [self.tweet_ids[1]])

    def test_list_source_scan_runs_page_supports_pagination(self) -> None:
        source = create_source("profile", self.source_urls[2])
        first_id = start_source_scan_run(
            int(source["id"]),
            "manual_next",
            {"start": 1, "end": 20, "limit": 20},
            {},
            worker_id="worker-test",
        )
        with connect() as conn:
            with conn.cursor() as cur:
                cur.execute("update source_scan_runs set status = 'succeeded', finished_at = now() where id = %s", (first_id,))
            conn.commit()
        second_id = start_source_scan_run(
            int(source["id"]),
            "latest_refresh",
            {"start": 1, "end": 20, "limit": 20},
            {},
            worker_id="worker-test",
        )

        page = list_source_scan_runs_page(int(source["id"]), limit=1, offset=1)

        self.assertEqual(page["count"], 1)
        self.assertEqual(page["total_count"], 2)
        self.assertEqual(page["rows"][0]["id"], first_id)
        self.assertNotEqual(page["rows"][0]["id"], second_id)

    def test_retry_failed_source_download_requeues_existing_failed_item(self) -> None:
        source = create_source("user_media", self.source_urls[0])
        record_source_discoveries(
            int(source["id"]),
            [
                {
                    "tweet_id": self.tweet_ids[0],
                    "url": f"https://x.com/sourcefixture/status/{self.tweet_ids[0]}",
                    "author_username": "sourcefixture",
                    "author_display_name": None,
                    "text": "failed tweet",
                    "published_at": None,
                    "collected_at": None,
                    "raw_import": {"media_count": 1},
                }
            ],
        )
        submitted = submit_source_downloads(int(source["id"]), "all_unsubmitted")
        with connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    update archive_run_items
                    set status = 'failed_retryable',
                        error_category = 'network_error',
                        error_message = 'temporary'
                    where archive_run_id = %s
                    """,
                    (submitted["run_id"],),
                )
                cur.execute(
                    """
                    update archive_runs
                    set status = 'completed_with_failures',
                        finished_at = now()
                    where id = %s
                    """,
                    (submitted["run_id"],),
                )
                cur.execute(
                    """
                    update tweets
                    set download_status = 'failed_retryable',
                        last_error = 'temporary'
                    where tweet_id = %s
                    """,
                    (self.tweet_ids[0],),
                )
            conn.commit()

        retried = submit_source_downloads(int(source["id"]), "failed")

        with connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "select status, error_category, error_message from archive_run_items where archive_run_id = %s",
                    (submitted["run_id"],),
                )
                item = cur.fetchone()
                cur.execute("select status from archive_runs where id = %s", (submitted["run_id"],))
                run = cur.fetchone()

        self.assertEqual(retried["run_id"], submitted["run_id"])
        self.assertEqual(retried["submitted_count"], 1)
        self.assertEqual(item["status"], "pending")
        self.assertIsNone(item["error_category"])
        self.assertIsNone(item["error_message"])
        self.assertEqual(run["status"], "queued")

    def test_retry_failed_source_download_is_noop_without_failed_items(self) -> None:
        source = create_source("user_media", self.source_urls[0])

        result = submit_source_downloads(int(source["id"]), "failed")

        self.assertIsNone(result["run_id"])
        self.assertEqual(result["submitted_count"], 0)
        self.assertEqual(result["tasks"]["queued_count"], 0)

    def test_download_summary_only_aggregates_active_run_progress(self) -> None:
        source = create_source("user_media", self.source_urls[0])
        record_source_discoveries(
            int(source["id"]),
            [
                {
                    "tweet_id": tweet_id,
                    "url": f"https://x.com/sourcefixture/status/{tweet_id}",
                    "author_username": "sourcefixture",
                    "author_display_name": None,
                    "text": None,
                    "published_at": None,
                    "collected_at": None,
                    "raw_import": {"media_count": 1},
                }
                for tweet_id in self.tweet_ids
            ],
        )
        first = submit_source_downloads(int(source["id"]), "selected", tweet_ids=[self.tweet_ids[0]])
        with connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "update archive_run_items set status = 'verified', downloaded_bytes = 9000, total_bytes = 9000 where archive_run_id = %s",
                    (first["run_id"],),
                )
                cur.execute(
                    "update archive_runs set status = 'completed', finished_at = now() where id = %s",
                    (first["run_id"],),
                )
            conn.commit()

        second = submit_source_downloads(int(source["id"]), "selected", tweet_ids=[self.tweet_ids[1]])
        with connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "update archive_run_items set status = 'processing', downloaded_bytes = 125, total_bytes = 500, speed_bps = 25 where archive_run_id = %s",
                    (second["run_id"],),
                )
                cur.execute("update archive_runs set status = 'running' where id = %s", (second["run_id"],))
                cur.execute(
                    """
                    insert into download_jobs (
                        job_type, status, total_count, archive_run_id, current_tweet_id, last_progress_at
                    ) values ('download', 'running', 1, %s, %s, now())
                    """,
                    (second["run_id"], self.tweet_ids[1]),
                )
            conn.commit()

        summary = get_source_downloads(int(source["id"]))

        self.assertEqual(summary["active_run"]["id"], second["run_id"])
        self.assertEqual(summary["current_tweet_id"], self.tweet_ids[1])
        self.assertEqual(
            summary["active_counts"],
            {
                "total_count": 1,
                "settled_count": 0,
                "pending_count": 0,
                "blocked_count": 0,
                "processing_count": 1,
                "failed_retryable_count": 0,
                "verified_count": 0,
                "skipped_verified_count": 0,
                "linked_pending_count": 0,
                "failed_permanent_count": 0,
                "cancelled_count": 0,
            },
        )
        self.assertEqual(summary["downloaded_bytes"], 125)
        self.assertEqual(summary["total_bytes"], 500)
        self.assertEqual(summary["speed_bps"], 25)

    def test_batch_progress_is_counted_once_across_run_items(self) -> None:
        source = create_source("user_media", self.source_urls[0])
        record_source_discoveries(
            int(source["id"]),
            [
                {
                    "tweet_id": tweet_id,
                    "url": f"https://x.com/sourcefixture/status/{tweet_id}",
                    "author_username": "sourcefixture",
                    "author_display_name": None,
                    "text": None,
                    "published_at": None,
                    "collected_at": None,
                    "raw_import": {"media_count": 1},
                }
                for tweet_id in self.tweet_ids
            ],
        )
        submitted = submit_source_downloads(int(source["id"]), "all_unsubmitted")
        with connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "select id, tweet_id from archive_run_items where archive_run_id = %s order by id",
                    (submitted["run_id"],),
                )
                item_ids = {str(row["tweet_id"]): int(row["id"]) for row in cur.fetchall()}
                cur.execute(
                    "insert into download_jobs (job_type, status, total_count, archive_run_id) values ('download', 'running', 2, %s) returning id",
                    (submitted["run_id"],),
                )
                job_id = int(cur.fetchone()["id"])
            conn.commit()

        candidates = [{"tweet_id": tweet_id} for tweet_id in self.tweet_ids]
        mark_run_items_progress(
            job_id,
            candidates,
            item_ids,
            "yt-dlp 下载中",
            downloaded_bytes=125,
            total_bytes=500,
            speed_bps=25,
        )

        with connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "select sum(downloaded_bytes)::bigint as downloaded_bytes, sum(total_bytes)::bigint as total_bytes, sum(speed_bps)::bigint as speed_bps from archive_run_items where archive_run_id = %s",
                    (submitted["run_id"],),
                )
                progress = cur.fetchone()

        self.assertEqual(progress["downloaded_bytes"], 125)
        self.assertEqual(progress["total_bytes"], 500)
        self.assertEqual(progress["speed_bps"], 25)

    def test_tweet_progress_updates_each_item_and_clears_stale_speeds(self) -> None:
        source = create_source("user_media", self.source_urls[0])
        record_source_discoveries(
            int(source["id"]),
            [
                {
                    "tweet_id": tweet_id,
                    "url": f"https://x.com/sourcefixture/status/{tweet_id}",
                    "author_username": "sourcefixture",
                    "author_display_name": None,
                    "text": None,
                    "published_at": None,
                    "collected_at": None,
                    "raw_import": {"media_count": 1},
                }
                for tweet_id in self.tweet_ids
            ],
        )
        submitted = submit_source_downloads(int(source["id"]), "all_unsubmitted")
        with connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "select id, tweet_id from archive_run_items where archive_run_id = %s order by id",
                    (submitted["run_id"],),
                )
                item_ids = {str(row["tweet_id"]): int(row["id"]) for row in cur.fetchall()}
                cur.execute(
                    "insert into download_jobs (job_type, status, total_count, archive_run_id) values ('download', 'running', 2, %s) returning id",
                    (submitted["run_id"],),
                )
                job_id = int(cur.fetchone()["id"])
            conn.commit()
        candidates = [{"tweet_id": tweet_id} for tweet_id in self.tweet_ids]

        with patch("xarchiver.downloader.publish_event") as publish_event:
            mark_run_items_tweet_progress(
                job_id,
                candidates,
                item_ids,
                "gallery-dl 下载中（估算）",
                {
                    self.tweet_ids[0]: {"downloaded_bytes": 100, "speed_bps": 10},
                    self.tweet_ids[1]: {"downloaded_bytes": 250, "speed_bps": 25},
                },
                current_tweet_id=self.tweet_ids[1],
            )
            publish_event.assert_called_once()

        mark_run_items_tweet_progress(
            job_id,
            candidates,
            item_ids,
            "yt-dlp 下载中",
            {self.tweet_ids[0]: {"downloaded_bytes": 150, "total_bytes": 300, "speed_bps": 15}},
            current_tweet_id=self.tweet_ids[0],
        )

        with connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "select tweet_id, downloaded_bytes, total_bytes, speed_bps from archive_run_items where archive_run_id = %s order by tweet_id",
                    (submitted["run_id"],),
                )
                rows = {str(row["tweet_id"]): row for row in cur.fetchall()}

        self.assertEqual(rows[self.tweet_ids[0]]["downloaded_bytes"], 150)
        self.assertEqual(rows[self.tweet_ids[0]]["total_bytes"], 300)
        self.assertEqual(rows[self.tweet_ids[0]]["speed_bps"], 15)
        self.assertEqual(rows[self.tweet_ids[1]]["downloaded_bytes"], 250)
        self.assertEqual(rows[self.tweet_ids[1]]["speed_bps"], 0)

    def test_recover_expired_source_scan_lease_marks_run_failed(self) -> None:
        source = create_source("profile", self.source_urls[2])
        with connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    insert into source_scan_runs (
                      source_id, trigger_type, status, requested_limit,
                      worker_id, claimed_at, lease_expires_at
                    )
                    values (
                      %s, 'history_worker', 'running', 20,
                      'worker-old', now() - interval '2 minutes', now() - interval '1 second'
                    )
                    returning id
                    """,
                    (source["id"],),
                )
                scan_run_id = int(cur.fetchone()["id"])
            conn.commit()

        recovered = recover_expired_source_scan_leases()

        with connect() as conn:
            with conn.cursor() as cur:
                cur.execute("select status, error_category, worker_id from source_scan_runs where id = %s", (scan_run_id,))
                row = cur.fetchone()
        self.assertEqual(recovered, 1)
        self.assertEqual(row["status"], "failed")
        self.assertEqual(row["error_category"], "worker_lease_expired")
        self.assertIsNone(row["worker_id"])

if __name__ == "__main__":
    unittest.main()
