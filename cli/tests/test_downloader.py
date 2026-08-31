import subprocess
import tempfile
import unittest
from contextlib import ExitStack
from pathlib import Path
from queue import Queue
from threading import Event, Lock
from types import SimpleNamespace
from unittest.mock import patch

from xarchiver.core.errors import ErrorCategory, classify_x_error
from xarchiver.db import connect
from xarchiver.downloader import (
    DownloadProgressState,
    TextTailBuffer,
    build_command,
    classify_error,
    classify_missing_tweets,
    create_job,
    download,
    download_log_relative_path,
    download_output_log_level,
    estimate_downloaded_bytes_by_tweet,
    extract_tweet_stderr,
    fetch_download_candidates,
    finish_job,
    flush_download_log_entries,
    flush_pending_download_progress,
    format_sleep_range,
    handle_gallery_dl_progress_event,
    parse_downloader_progress,
    parse_gallery_dl_progress,
    parse_gallery_dl_size,
    prepare_cookies,
    queue_download_log_entry,
    resolve_gallery_dl_progress_path,
    run_command_with_progress,
    sample_current_download_path,
    should_run_fallback_scan,
    validate_cookie_file,
)


class DownloaderTests(unittest.TestCase):
    def test_text_tail_buffer_keeps_only_configured_tail(self) -> None:
        buffer = TextTailBuffer(5)

        buffer.append("abc")
        buffer.append("def")
        self.assertEqual(buffer.getvalue(), "bcdef")

        buffer.append("123456")
        self.assertEqual(buffer.getvalue(), "23456")

    def test_validate_cookie_file_reports_missing_for_yt_dlp(self) -> None:
        self.assertEqual(validate_cookie_file("yt-dlp", Path("missing-cookies.txt")), "cookie_missing")

    def test_validate_cookie_file_reports_missing_for_gallery_dl(self) -> None:
        self.assertEqual(validate_cookie_file("gallery-dl", Path("missing-cookies.txt")), "cookie_missing")

    def test_validate_cookie_file_reports_missing_for_none_path(self) -> None:
        self.assertEqual(validate_cookie_file("yt-dlp", None), "cookie_missing")

    def test_validate_cookie_file_reports_empty(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            cookie_file = Path(tmp) / "cookies.txt"
            cookie_file.write_text("", encoding="utf-8")
            self.assertEqual(validate_cookie_file("yt-dlp", cookie_file), "cookie_empty")

    def test_classify_error_detects_auth_and_rate_limit(self) -> None:
        self.assertEqual(classify_error(1, "Login required to access this page"), "auth_required")
        self.assertEqual(classify_error(1, "HTTP Error 429: rate limited"), "rate_limited")

    def test_classify_error_detects_cookie_and_no_media(self) -> None:
        self.assertEqual(classify_error(1, "cookies file is invalid"), "auth_required")
        self.assertEqual(classify_error(0, "No results for this tweet"), "download_no_output")
        self.assertEqual(classify_error(1, "No video could be found in this tweet"), "unsupported_media")

    def test_classify_error_uses_queue_category_contract(self) -> None:
        self.assertEqual(classify_error(1, "HTTP Error 404: not found"), "invalid_url")
        self.assertEqual(classify_error(1, "Connection timed out"), "network_error")
        self.assertEqual(
            classify_error(1, "transfer rate dropped after SSLError: UNEXPECTED_EOF_WHILE_READING"),
            "network_error",
        )
        self.assertEqual(classify_error(2, "unexpected stderr"), "unknown")

    def test_extract_tweet_stderr_keeps_batch_errors_with_their_tweet(self) -> None:
        stderr = """[1/2] https://x.com/author/status/111
SSLError: UNEXPECTED_EOF_WHILE_READING
[2/2] https://x.com/author/status/222
ERROR: [twitter] 222: No video could be found in this tweet
"""

        segments = extract_tweet_stderr(stderr, {"111", "222"})

        self.assertIn("SSLError", segments["111"])
        self.assertNotIn("No video", segments["111"])
        self.assertIn("No video", segments["222"])

    def test_extract_tweet_stderr_stops_at_an_unselected_tweet_marker(self) -> None:
        stderr = """[1/2] https://x.com/author/status/111
first tweet warning
[2/2] https://x.com/author/status/222
second tweet warning
"""

        segments = extract_tweet_stderr(stderr, {"111"})

        self.assertIn("first tweet warning", segments["111"])
        self.assertNotIn("second tweet warning", segments["111"])

    def test_missing_tweet_without_own_error_stays_retryable(self) -> None:
        tweets = [
            {"tweet_id": "111", "url": "https://x.com/author/status/111"},
            {"tweet_id": "222", "url": "https://x.com/author/status/222"},
        ]
        stderr = "ERROR: [twitter] 222: No video could be found in this tweet"

        details = classify_missing_tweets(tweets, 1, stderr)

        self.assertEqual(details["111"]["category"], "download_no_output")
        self.assertEqual(details["111"]["status"], "failed_retryable")
        self.assertEqual(details["222"]["category"], "unsupported_media")
        self.assertEqual(details["222"]["status"], "failed_permanent")

    def test_missing_tweets_share_a_command_wide_network_error(self) -> None:
        tweets = [
            {"tweet_id": "111", "url": "https://x.com/author/status/111"},
            {"tweet_id": "222", "url": "https://x.com/author/status/222"},
        ]

        details = classify_missing_tweets(
            tweets,
            1,
            "SSLError: UNEXPECTED_EOF_WHILE_READING",
        )

        self.assertEqual(details["111"]["category"], "network_error")
        self.assertEqual(details["222"]["category"], "network_error")

    def test_download_log_helpers_use_stable_path_and_levels(self) -> None:
        self.assertEqual(download_log_relative_path(114), "logs/download-logs/job-114.jsonl")
        self.assertEqual(download_output_log_level("yt-dlp", "stderr", "ERROR: unavailable"), "error")
        self.assertEqual(download_output_log_level("yt-dlp", "stdout", "[download] 20%"), "info")
        self.assertEqual(download_output_log_level("yt-dlp", "stderr", "0 errors so far"), "info")
        self.assertEqual(download_output_log_level("gallery-dl", "stderr", "[warning] retry"), "warning")

    def test_download_backfills_partial_batch_before_classifying_failures(self) -> None:
        tweets = [
            {"tweet_id": "111", "url": "https://x.com/author/status/111"},
            {"tweet_id": "222", "url": "https://x.com/author/status/222"},
        ]
        process_result = subprocess.CompletedProcess(
            args=["yt-dlp"],
            returncode=1,
            stdout="",
            stderr="ERROR: [twitter] 222: No video could be found in this tweet",
        )
        backfill_result = {
            "scanned": 1,
            "upserted": 1,
            "skipped": 0,
            "media_ids": [71],
            "tweet_ids": ["111"],
            "media_ids_by_engine": {"yt-dlp": [71]},
            "tweet_ids_by_engine": {"yt-dlp": ["111"]},
        }
        settings = SimpleNamespace(archive_dir=Path("/tmp/archive"))

        with ExitStack() as stack:
            for target in (
                "ensure_archive_dirs",
                "append_download_log",
                "log_download_event",
                "set_tweets_downloading",
                "mark_run_items_progress",
                "mark_run_items_finished",
            ):
                stack.enter_context(patch(f"xarchiver.downloader.{target}"))
            stack.enter_context(
                patch("xarchiver.downloader.fetch_download_candidates", return_value=tweets)
            )
            stack.enter_context(
                patch("xarchiver.downloader.write_input_file", return_value=Path("/tmp/input.txt"))
            )
            stack.enter_context(patch("xarchiver.downloader.create_job", return_value=9))
            stack.enter_context(
                patch("xarchiver.downloader.get_download_job_log_stream_id", return_value=None)
            )
            stack.enter_context(
                patch(
                    "xarchiver.downloader.prepare_cookies",
                    return_value=Path("/tmp/cookies.txt"),
                )
            )
            stack.enter_context(patch("xarchiver.downloader.validate_cookie_file", return_value=None))
            stack.enter_context(patch("xarchiver.downloader.build_command", return_value=["yt-dlp"]))
            stack.enter_context(patch("xarchiver.downloader.shutil.which", return_value="/usr/bin/yt-dlp"))
            stack.enter_context(
                patch("xarchiver.downloader.run_command_with_progress", return_value=process_result)
            )
            stack.enter_context(
                patch("xarchiver.downloader.backfill_media_assets", return_value=backfill_result)
            )
            stack.enter_context(
                patch("xarchiver.downloader.sync_gallery_hashtags_after_backfill", return_value=None)
            )
            stack.enter_context(
                patch("xarchiver.downloader.fetch_media_sizes", return_value={"111": 100})
            )
            attempts = stack.enter_context(patch("xarchiver.downloader.mark_attempts"))
            mark_downloaded = stack.enter_context(patch("xarchiver.downloader.mark_tweets_downloaded"))
            mark_failed = stack.enter_context(patch("xarchiver.downloader.mark_tweets_failed"))
            finish = stack.enter_context(patch("xarchiver.downloader.finish_job"))
            result = download(
                "yt-dlp",
                settings,
                limit=None,
                dry_run=False,
                tweet_ids=["111", "222"],
                archive_run_id=3,
                run_item_ids={"111": 31, "222": 32},
            )

        self.assertEqual(result["downloaded_tweet_ids"], ["111"])
        self.assertEqual(result["media_backfill"], backfill_result)
        self.assertEqual(attempts.call_args_list[0].args[1], [tweets[0]])
        self.assertEqual(attempts.call_args_list[0].args[3], "downloaded")
        self.assertEqual(attempts.call_args_list[1].args[1], [tweets[1]])
        self.assertEqual(attempts.call_args_list[1].args[3], "failed_permanent")
        self.assertEqual(attempts.call_args_list[1].args[5], "unsupported_media")
        mark_downloaded.assert_called_once_with(["111"])
        mark_failed.assert_called_once_with(["222"], "failed_permanent", "unsupported_media")
        finish.assert_called_once_with(9, "partial", 1, 1, "unsupported_media")

    def test_download_log_buffer_batches_stdout_and_stderr(self) -> None:
        pending: Queue[dict[str, object]] = Queue()
        stop_event = Event()
        queue_download_log_entry(pending, stop_event, level="info", component="yt-dlp.stdout", message="out", raw="out\n")
        queue_download_log_entry(pending, stop_event, level="error", component="yt-dlp.stderr", message="err", raw="err\n")

        with patch("xarchiver.downloader.append_operation_log_entries", return_value=[{}, {}]) as append:
            written = flush_download_log_entries(11, pending)

        self.assertEqual(written, 2)
        self.assertTrue(pending.empty())
        self.assertEqual([item["component"] for item in append.call_args.args[1]], ["yt-dlp.stdout", "yt-dlp.stderr"])

    def test_downloader_log_flush_failure_stops_process_and_closes_pipes(self) -> None:
        class FakePipe:
            def __init__(self, lines):
                self.lines = lines
                self.started = Event()
                self.closed = False

            def __iter__(self):
                self.started.set()
                return iter(self.lines)

            def close(self):
                self.closed = True

        class FakeProcess:
            def __init__(self):
                self.stdout = FakePipe(["plain downloader output\n"])
                self.stderr = FakePipe([])
                self.terminated = False
                self.killed = False

            def poll(self):
                self.stdout.started.wait(timeout=0.2)
                return -9 if self.killed else -15 if self.terminated else None

            def terminate(self):
                self.terminated = True

            def kill(self):
                self.killed = True

            def wait(self, timeout=None):
                if self.poll() is None:
                    raise subprocess.TimeoutExpired("downloader", timeout)
                return self.poll()

        process = FakeProcess()
        settings = SimpleNamespace(
            archive_dir=Path("/tmp/archive"),
            downloader_progress_fallback_interval_seconds=0,
        )
        with (
            patch("xarchiver.downloader.subprocess.Popen", return_value=process),
            patch("xarchiver.downloader.time.sleep"),
            patch(
                "xarchiver.downloader.append_operation_log_entries",
                side_effect=RuntimeError("download log failed"),
            ),
            self.assertRaisesRegex(RuntimeError, "download log failed"),
        ):
            run_command_with_progress(
                ["yt-dlp", "url"],
                settings,
                11,
                [{"tweet_id": "1"}],
                None,
                "yt-dlp",
                log_stream_id=91,
            )

        self.assertTrue(process.terminated)
        self.assertTrue(process.stdout.closed)
        self.assertTrue(process.stderr.closed)

    def test_downloader_reader_failure_is_raised_and_stops_process(self) -> None:
        class FakePipe:
            def __init__(self, lines):
                self.lines = lines
                self.started = Event()
                self.closed = False

            def __iter__(self):
                self.started.set()
                return iter(self.lines)

            def close(self):
                self.closed = True

        class FakeProcess:
            def __init__(self):
                self.stdout = FakePipe(["xarchiver-progress:1|downloading|10|100|100|5\n"])
                self.stderr = FakePipe([])
                self.terminated = False

            def poll(self):
                self.stdout.started.wait(timeout=0.2)
                return -15 if self.terminated else None

            def terminate(self):
                self.terminated = True

            def kill(self):
                self.terminated = True

            def wait(self, timeout=None):
                if self.poll() is None:
                    raise subprocess.TimeoutExpired("downloader", timeout)
                return -15

        process = FakeProcess()
        settings = SimpleNamespace(
            archive_dir=Path("/tmp/archive"),
            downloader_progress_fallback_interval_seconds=0,
        )
        with (
            patch("xarchiver.downloader.subprocess.Popen", return_value=process),
            patch("xarchiver.downloader.time.sleep"),
            patch("xarchiver.downloader.append_operation_log_entries", return_value=[{}]) as append_logs,
            patch(
                "xarchiver.downloader.record_download_progress",
                side_effect=RuntimeError("progress write failed"),
            ),
            self.assertRaisesRegex(RuntimeError, "downloader_stdout_reader_failed") as error,
        ):
            run_command_with_progress(
                ["yt-dlp", "url"],
                settings,
                11,
                [{"tweet_id": "1"}],
                None,
                "yt-dlp",
                log_stream_id=92,
            )

        self.assertIsInstance(error.exception.__cause__, RuntimeError)
        self.assertTrue(
            any(
                entry["message"].startswith("xarchiver-progress:1|")
                for call in append_logs.call_args_list
                for entry in call.args[1]
            )
        )
        self.assertTrue(process.terminated)
        self.assertTrue(process.stdout.closed)
        self.assertTrue(process.stderr.closed)

    def test_downloader_reader_failure_remains_primary_when_final_log_flush_fails(self) -> None:
        reader_failed = Event()

        class FakePipe:
            def __init__(self, lines):
                self.lines = lines
                self.closed = False

            def __iter__(self):
                return iter(self.lines)

            def close(self):
                self.closed = True

        class FakeProcess:
            def __init__(self):
                self.stdout = FakePipe(["xarchiver-progress:1|downloading|10|100|100|5\n"])
                self.stderr = FakePipe([])
                self.terminated = False

            def poll(self):
                reader_failed.wait(timeout=0.2)
                return -15 if self.terminated else None

            def terminate(self):
                self.terminated = True

            def kill(self):
                self.terminated = True

            def wait(self, timeout=None):
                if self.poll() is None:
                    raise subprocess.TimeoutExpired("downloader", timeout)
                return -15

        def fail_progress(*_args, **_kwargs):
            reader_failed.set()
            raise RuntimeError("progress write failed")

        process = FakeProcess()
        settings = SimpleNamespace(
            archive_dir=Path("/tmp/archive"),
            downloader_progress_fallback_interval_seconds=0,
        )
        with (
            patch("xarchiver.downloader.subprocess.Popen", return_value=process),
            patch(
                "xarchiver.downloader.time.sleep",
                side_effect=lambda _seconds: Event().wait(timeout=0.02),
            ),
            patch(
                "xarchiver.downloader.append_operation_log_entries",
                side_effect=RuntimeError("final log flush failed"),
            ),
            patch("xarchiver.downloader.record_download_progress", side_effect=fail_progress),
            self.assertRaisesRegex(RuntimeError, "downloader_stdout_reader_failed") as error,
        ):
            run_command_with_progress(
                ["yt-dlp", "url"],
                settings,
                11,
                [{"tweet_id": "1"}],
                None,
                "yt-dlp",
                log_stream_id=93,
            )

        self.assertIsInstance(error.exception.__cause__, RuntimeError)
        self.assertIn("progress write failed", str(error.exception.__cause__))
        self.assertTrue(
            any("pending downloader log flush failed" in note for note in error.exception.__notes__)
        )
        self.assertTrue(process.terminated)

    def test_create_and_finish_job_manage_log_stream_lifecycle(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            settings = SimpleNamespace(archive_dir=Path(tmp), operation_log_max_bytes=10_000)
            with patch("xarchiver.services.operation_logs.get_settings", return_value=settings):
                job_id = create_job("yt-dlp", Path(tmp) / "input.txt", 1, "running")
                finish_job(job_id, "finished", 1, 0, None)
            with connect() as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        """
                        select j.log_stream_id, l.log_path, l.closed_at
                        from download_jobs j join operation_log_streams l on l.id = j.log_stream_id
                        where j.id = %s
                        """,
                        (job_id,),
                    )
                    row = cur.fetchone()
                    cur.execute("delete from download_jobs where id = %s", (job_id,))
                    cur.execute("delete from operation_log_streams where id = %s", (row["log_stream_id"],))
                conn.commit()

        self.assertEqual(row["log_path"], f"logs/download-logs/job-{job_id}.jsonl")
        self.assertIsNotNone(row["closed_at"])

    def test_core_error_classifier_is_single_source_for_x_errors(self) -> None:
        self.assertEqual(classify_x_error("HTTP Error 429: rate limited"), ErrorCategory.RATE_LIMITED)
        self.assertEqual(classify_x_error("No media found"), ErrorCategory.UNSUPPORTED_MEDIA)

    def test_format_sleep_range_normalizes_values(self) -> None:
        self.assertEqual(format_sleep_range(0, 3), "0-3")
        self.assertEqual(format_sleep_range(6, 2), "6")

    def test_gallery_dl_command_includes_request_sleep(self) -> None:
        settings = SimpleNamespace(
            archive_dir=Path("/app/archive"),
            downloader_sleep_min_seconds=0,
            downloader_sleep_max_seconds=3,
        )

        cookie_path = Path("/app/archive/state/runtime-cookies.txt")
        command = build_command(
            "gallery-dl",
            settings,
            Path("/app/archive/raw/input.txt"),
            cookie_path,
        )

        self.assertIn("--sleep-request", command)
        self.assertIn("0-3", command)
        self.assertIn(f"extractor.twitter.cookies={cookie_path}", command)
        self.assertIn("extractor.twitter.cookies-update=false", command)
        self.assertTrue(any("output.mode=" in value for value in command))
        self.assertIn("output.ansi=false", command)
        self.assertIn("output.shorten=false", command)
        self.assertIn("downloader.progress=1.0", command)

    def test_yt_dlp_command_includes_sleep_options(self) -> None:
        settings = SimpleNamespace(
            archive_dir=Path("/app/archive"),
            downloader_sleep_min_seconds=0,
            downloader_sleep_max_seconds=3,
        )

        cookie_path = Path("/app/archive/state/runtime-cookies.txt")
        command = build_command(
            "yt-dlp",
            settings,
            Path("/app/archive/raw/input.txt"),
            cookie_path,
        )

        self.assertIn("--sleep-requests", command)
        self.assertIn("--sleep-interval", command)
        self.assertIn("--max-sleep-interval", command)
        self.assertIn(str(cookie_path), command)

    def test_yt_dlp_command_includes_native_progress_template(self) -> None:
        settings = SimpleNamespace(
            archive_dir=Path("/app/archive"),
            downloader_sleep_min_seconds=0,
            downloader_sleep_max_seconds=3,
        )

        command = build_command(
            "yt-dlp",
            settings,
            Path("/app/archive/raw/input.txt"),
            Path("/app/archive/state/runtime-cookies.txt"),
        )

        self.assertIn("--newline", command)
        self.assertIn("--no-color", command)
        self.assertIn("--progress-delta", command)
        self.assertIn("--progress-template", command)
        template = next(value for value in command if "xarchiver-progress:" in value)
        self.assertIn("%(info.display_id)s", template)

    def test_parse_downloader_progress_reads_yt_dlp_template_output(self) -> None:
        progress = parse_downloader_progress("xarchiver-progress:123|downloading|2048|4096|8192|512")

        self.assertEqual(
            progress,
            {"tweet_id": "123", "downloaded_bytes": 2048, "total_bytes": 4096, "speed_bps": 512},
        )

    def test_parse_downloader_progress_uses_estimated_total(self) -> None:
        progress = parse_downloader_progress("xarchiver-progress:123|downloading|2048|NA|8192|512")

        self.assertEqual(progress["total_bytes"], 8192)

    def test_parse_gallery_dl_file_event(self) -> None:
        progress = parse_gallery_dl_progress(
            "xarchiver-gdl:start|/app/archive/media/author/123/123--p1.jpg"
        )

        self.assertEqual(
            progress,
            {
                "event": "start",
                "filename": "/app/archive/media/author/123/123--p1.jpg",
            },
        )

    def test_parse_gallery_dl_progress_event(self) -> None:
        progress = parse_gallery_dl_progress("xarchiver-gdl:progress|2.04K|512|4.09K|50")

        self.assertEqual(
            progress,
            {
                "event": "progress",
                "downloaded_bytes": 2040,
                "speed_bps": 512,
                "total_bytes": 4090,
                "percent": 50,
            },
        )

    def test_parse_gallery_dl_size_supports_binary_units(self) -> None:
        self.assertEqual(parse_gallery_dl_size("1.50Mi"), 1572864)

    def test_resolve_gallery_dl_progress_path_maps_exact_tweet_directory(self) -> None:
        archive_dir = Path("/app/archive")

        resolved = resolve_gallery_dl_progress_path(
            "author/123/123--p1.jpg",
            archive_dir,
            {"123", "1234"},
        )

        self.assertEqual(
            resolved,
            (
                "123",
                (archive_dir / "media" / "author" / "123" / "123--p1.jpg").resolve(),
            ),
        )

    def test_resolve_gallery_dl_progress_path_rejects_outside_media_root(self) -> None:
        resolved = resolve_gallery_dl_progress_path(
            "/tmp/123/file.jpg",
            Path("/app/archive"),
            {"123"},
        )

        self.assertIsNone(resolved)

    def test_sample_current_download_path_prefers_part_file(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / "video.mp4"
            target.write_bytes(b"done")
            Path(f"{target}.part").write_bytes(b"partial")

            size = sample_current_download_path(target)

        self.assertEqual(size, 7)

    def test_sample_current_download_path_uses_completed_file(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / "photo.jpg"
            target.write_bytes(b"complete")

            size = sample_current_download_path(target)

        self.assertEqual(size, 8)

    def test_fallback_scan_interval_can_be_delayed_or_disabled(self) -> None:
        self.assertFalse(should_run_fallback_scan(100.0, 109.9, 10.0))
        self.assertTrue(should_run_fallback_scan(100.0, 110.0, 10.0))
        self.assertFalse(should_run_fallback_scan(None, 110.0, 0.0))

    def test_gallery_dl_progress_accumulates_completed_files_per_tweet(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            archive_dir = Path(tmp)
            first = archive_dir / "media" / "author" / "123" / "123--p1.jpg"
            second = archive_dir / "media" / "author" / "123" / "123--p2.jpg"
            first.parent.mkdir(parents=True)
            first.write_bytes(b"1234567")
            state = DownloadProgressState()
            state_lock = Lock()
            candidate_tweets = [{"tweet_id": "123", "url": "https://x.com/test/status/123"}]

            with patch("xarchiver.downloader.mark_run_items_tweet_progress") as mark_progress:
                handle_gallery_dl_progress_event(
                    {"event": "start", "filename": str(first)},
                    archive_dir,
                    {"123"},
                    state,
                    state_lock,
                    1,
                    candidate_tweets,
                    {"123": 10},
                )
                handle_gallery_dl_progress_event(
                    {"event": "success", "filename": str(first)},
                    archive_dir,
                    {"123"},
                    state,
                    state_lock,
                    1,
                    candidate_tweets,
                    {"123": 10},
                )
                handle_gallery_dl_progress_event(
                    {"event": "start", "filename": str(second)},
                    archive_dir,
                    {"123"},
                    state,
                    state_lock,
                    1,
                    candidate_tweets,
                    {"123": 10},
                )
                handle_gallery_dl_progress_event(
                    {"event": "progress", "downloaded_bytes": 3, "speed_bps": 2},
                    archive_dir,
                    {"123"},
                    state,
                    state_lock,
                    1,
                    candidate_tweets,
                    {"123": 10},
                )
                flush_pending_download_progress(state, state_lock, 1, candidate_tweets, {"123": 10})

        self.assertEqual(state.completed_bytes_by_tweet, {"123": 7})
        self.assertEqual(mark_progress.call_count, 2)
        self.assertEqual(
            mark_progress.call_args.args[4],
            {"123": {"downloaded_bytes": 10, "speed_bps": 2}},
        )

    def test_estimate_downloaded_bytes_groups_files_by_exact_tweet_directory(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            archive_dir = Path(tmp)
            first = archive_dir / "media" / "author" / "123"
            second = archive_dir / "media" / "author" / "1234"
            first.mkdir(parents=True)
            second.mkdir(parents=True)
            (first / "photo.jpg").write_bytes(b"123")
            (first / "video.part").write_bytes(b"12345")
            (first / "metadata.json").write_bytes(b"ignored")
            (second / "video.mp4").write_bytes(b"1234567")

            sizes = estimate_downloaded_bytes_by_tweet(archive_dir, ["123", "1234"])

        self.assertEqual(sizes, {"123": 8, "1234": 7})

    def test_prepare_cookies_writes_file_fallback_to_runtime_path(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            cookie_file = root / "secrets" / "cookies.txt"
            cookie_file.parent.mkdir()
            cookie_file.write_text("# Netscape\n.example\tTRUE\t/\tTRUE\t0\tname\tvalue\n", encoding="utf-8")
            settings = SimpleNamespace(archive_dir=root / "archive", cookie_file=cookie_file)

            with patch("xarchiver.downloader.resolve_cookie_content") as mock:
                mock.return_value = SimpleNamespace(content=cookie_file.read_text(encoding="utf-8"))
                runtime_path = prepare_cookies(settings)

            self.assertEqual(runtime_path, root / "archive" / "state" / "runtime-cookies.txt")
            self.assertIn("name\tvalue", runtime_path.read_text(encoding="utf-8"))


class DownloadCandidateIntegrationTests(unittest.TestCase):
    tweet_ids = ["candidate-fixture-pending", "candidate-fixture-over-limit", "candidate-fixture-backoff"]

    def setUp(self) -> None:
        self.cleanup_db()
        with connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    insert into tweets (tweet_id, url, download_status, retry_count)
                    values (%s, %s, 'pending', 0)
                    """,
                    (self.tweet_ids[0], f"https://x.com/test/status/{self.tweet_ids[0]}"),
                )
                cur.execute(
                    """
                    insert into tweets (tweet_id, url, download_status, retry_count, last_attempt_at)
                    values (%s, %s, 'failed_retryable', 3, now() - interval '1 day')
                    """,
                    (self.tweet_ids[1], f"https://x.com/test/status/{self.tweet_ids[1]}"),
                )
                cur.execute(
                    """
                    insert into tweets (tweet_id, url, download_status, retry_count, last_attempt_at)
                    values (%s, %s, 'failed_retryable', 1, now())
                    """,
                    (self.tweet_ids[2], f"https://x.com/test/status/{self.tweet_ids[2]}"),
                )
            conn.commit()

    def tearDown(self) -> None:
        self.cleanup_db()

    def cleanup_db(self) -> None:
        with connect() as conn:
            with conn.cursor() as cur:
                cur.execute("delete from tweets where tweet_id = any(%s)", (self.tweet_ids,))
            conn.commit()

    def test_fetch_download_candidates_respects_retry_limit_and_backoff(self) -> None:
        tweet_ids = {
            row["tweet_id"]
            for row in fetch_download_candidates(limit=None, retry_limit=3, retry_backoff_minutes=15)
        }

        self.assertIn(self.tweet_ids[0], tweet_ids)
        self.assertNotIn(self.tweet_ids[1], tweet_ids)
        self.assertNotIn(self.tweet_ids[2], tweet_ids)

    def test_fetch_download_candidates_limits_query_to_scope(self) -> None:
        rows = fetch_download_candidates(
            limit=None,
            retry_limit=3,
            retry_backoff_minutes=15,
            tweet_ids=[self.tweet_ids[1]],
        )

        self.assertEqual(rows, [])


if __name__ == "__main__":
    unittest.main()
