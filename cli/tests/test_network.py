"""代理配置与三个网络入口的定向测试，不访问数据库或真实 X。"""

import json
import logging
import os
import re
import subprocess
import sys
import tempfile
import unittest
from contextlib import ExitStack
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from types import SimpleNamespace
from unittest.mock import patch

from pydantic import SecretStr, ValidationError

from xarchiver.api.middleware import JsonLogFormatter
from xarchiver.config import Settings
from xarchiver.core.errors import ErrorCategory, classify_x_error
from xarchiver.downloader import build_command, classify_missing_tweets
from xarchiver.services.cookies import run_cookie_check
from xarchiver.services.network import normalize_proxy_url, proxy_arguments
from xarchiver.services.operation_logs import build_log_entry, redact_sensitive_text
from xarchiver.services.sources import discover_records_with_gallery_dl, scan_source

PROXY = "http://proxy-user:proxy-password@mihomo:7890"


class NetworkProxyTests(unittest.TestCase):
    def settings(self, value: str | None) -> Settings:
        with patch.dict(os.environ, {}, clear=True):
            return Settings(
                _env_file=None,
                DATABASE_URL="postgresql://xarchiver@localhost/xarchiver_test",
                NETWORK_PROXY_URL=value,
            )

    def test_empty_config_preserves_networking(self) -> None:
        for value in (None, "", "   "):
            with self.subTest(value=value):
                self.assertIsNone(self.settings(value).network_proxy_url)
                self.assertEqual(proxy_arguments("gallery-dl", value), [])
                self.assertEqual(proxy_arguments("yt-dlp", value), [])

    def test_valid_urls_and_secret_settings(self) -> None:
        for value in (
            "http://mihomo:7890",
            PROXY,
            "http://192.168.1.10:7890/",
            "http://[::1]:7890",
            "http://mihomo",
        ):
            with self.subTest(value=value):
                self.assertEqual(self.settings(value).network_proxy_url.get_secret_value(), value)
        settings = self.settings(PROXY)
        self.assertNotIn("proxy-password", repr(settings))
        self.assertNotIn("proxy-password", settings.model_dump_json())
        self.assertEqual(normalize_proxy_url(SecretStr(PROXY)), PROXY)

    def test_invalid_config_errors_hide_credentials(self) -> None:
        for value in (
            "socks5://proxy-user:proxy-password@mihomo:7890",
            "https://proxy-user:proxy-password@mihomo:7890",
            "http://",
            "mihomo:7890",
            "http://mihomo:0",
            "http://mihomo:65536",
            "http://mihomo:bad",
            "http://[bad]:7890",
            "http://mi homo:7890",
            "http://mi\nhomo:7890",
            "http://mihomo:7890/path",
            "http://mihomo?secret=value",
            "http://mihomo#fragment",
            "http://proxy-user:proxy-password@tail@mihomo:7890",
        ):
            with self.subTest(value=value), self.assertRaises(ValidationError) as error:
                self.settings(value)
            self.assertNotIn("proxy-password", str(error.exception))
            self.assertNotIn(value, str(error.exception))

    def test_download_engines_use_explicit_proxy_over_environment(self) -> None:
        settings = self.settings(PROXY)
        with patch.dict(
            os.environ,
            {
                "HTTP_PROXY": "http://wrong-proxy:9999",
                "HTTPS_PROXY": "http://wrong-proxy:9999",
                "NO_PROXY": "*",
            },
        ):
            for engine in ("gallery-dl", "yt-dlp"):
                with self.subTest(engine=engine):
                    command = build_command(
                        engine, settings, Path("input.txt"), None, use_download_archive=False
                    )
                    self.assertEqual(command[command.index("--proxy") + 1], PROXY)
                    self.assertEqual("proxy-env=false" in command, engine == "gallery-dl")
                    self.assertNotIn("http://wrong-proxy:9999", command)
            self.assertEqual(os.environ["HTTP_PROXY"], "http://wrong-proxy:9999")

    def test_unconfigured_commands_do_not_add_proxy_options(self) -> None:
        settings = self.settings(None)
        for engine in ("gallery-dl", "yt-dlp"):
            command = build_command(engine, settings, Path("input.txt"), None)
            self.assertNotIn("--proxy", command)
            self.assertNotIn("proxy-env=false", command)

    def test_source_scan_both_execution_paths_use_proxy(self) -> None:
        completed = SimpleNamespace(returncode=0, stdout="[]", stderr="")
        for scan_run_id in (None, 9):
            with (
                self.subTest(scan_run_id=scan_run_id),
                patch("xarchiver.services.sources.shutil.which", return_value="gallery-dl"),
                patch("xarchiver.services.sources.subprocess.run", return_value=completed) as run,
                patch(
                    "xarchiver.services.sources.run_gallery_dl_streaming", return_value=completed
                ) as stream,
            ):
                discover_records_with_gallery_dl(
                    "https://x.com/example/media",
                    1,
                    20,
                    scan_run_id=scan_run_id,
                    network_proxy_url=SecretStr(PROXY),
                )
                command = (run if scan_run_id is None else stream).call_args.args[0]
                self.assertEqual(command[command.index("--proxy") + 1], PROXY)
                self.assertIn("proxy-env=false", command)
                self.assertEqual(command[-1], "https://x.com/example/media")
                (stream if scan_run_id is None else run).assert_not_called()

    def test_native_downloaders_connect_to_explicit_proxy_despite_environment(self) -> None:
        from gallery_dl import config as gallery_config
        from gallery_dl import option as gallery_option
        from gallery_dl.extractor.common import Extractor
        from yt_dlp import YoutubeDL, parse_options

        connections = []

        class RejectingProxy(BaseHTTPRequestHandler):
            def do_CONNECT(self):
                connections.append((self.path, self.headers.get("Proxy-Authorization")))
                self.send_response(407)
                self.end_headers()

            def log_message(self, *_args):
                pass

        with ThreadingHTTPServer(("127.0.0.1", 0), RejectingProxy) as server:
            thread = Thread(target=server.serve_forever, daemon=True)
            thread.start()
            proxy = f"http://proxy-user:proxy-password@127.0.0.1:{server.server_port}"
            try:
                with patch.dict(
                    os.environ,
                    {
                        "HTTP_PROXY": "http://127.0.0.1:1",
                        "HTTPS_PROXY": "http://127.0.0.1:1",
                        "NO_PROXY": "*",
                    },
                ):
                    with patch.dict(gallery_config._config, {}, clear=True):
                        args = gallery_option.build_parser().parse_args(
                            proxy_arguments("gallery-dl", proxy)
                        )
                        for path, key, value in args.options:
                            gallery_config.set(path, key, value)
                        gallery_config.set((), "retries", 0)
                        gallery_config.set((), "timeout", 1)
                        extractor = Extractor(re.match("", "https://example.invalid/"))
                        extractor.initialize()
                        try:
                            with self.assertRaises(Exception):
                                extractor.request("https://example.invalid/")
                        finally:
                            extractor.session.close()
                        self.assertEqual(len(connections), 1)

                    options = parse_options(
                        [
                            "--ignore-config",
                            *proxy_arguments("yt-dlp", proxy),
                            "--socket-timeout",
                            "1",
                        ]
                    ).ydl_opts
                    with YoutubeDL(options) as downloader, self.assertRaises(Exception):
                        downloader.urlopen("https://example.invalid/")
                    self.assertEqual(len(connections), 2)
                    self.assertTrue(
                        all(
                            target == "example.invalid:443" and auth and auth.startswith("Basic ")
                            for target, auth in connections
                        )
                    )
            finally:
                server.shutdown()
                thread.join(timeout=2)

    def test_cookie_check_uses_proxy_and_cleans_up_after_network_failure(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            settings = SimpleNamespace(archive_dir=Path(tmp), network_proxy_url=SecretStr(PROXY))
            for failure in (
                "[twitter][error] 407 Proxy Authentication Required",
                "[twitter][error] ProxyError: Connection refused",
                "Read timed out. (3/3)",
            ):
                with (
                    self.subTest(failure=failure),
                    patch("xarchiver.services.cookies.shutil.which", return_value="gallery-dl"),
                    patch(
                        "xarchiver.services.cookies.subprocess.run",
                        return_value=SimpleNamespace(returncode=0, stderr=failure),
                    ) as run,
                ):
                    self.assertEqual(
                        run_cookie_check(settings, "synthetic cookies"),
                        ("error", "network_error", "cookie_check_network_error"),
                    )
                    command = run.call_args.args[0]
                    self.assertEqual(command[command.index("--proxy") + 1], PROXY)
                    self.assertIn("proxy-env=false", command)
                    self.assertEqual(list((Path(tmp) / "state").iterdir()), [])

    def test_cookie_check_timeout_does_not_expose_command(self) -> None:
        with (
            tempfile.TemporaryDirectory() as tmp,
            patch("xarchiver.services.cookies.shutil.which", return_value="gallery-dl"),
            patch(
                "xarchiver.services.cookies.subprocess.run",
                side_effect=subprocess.TimeoutExpired(["gallery-dl", "--proxy", PROXY], 60),
            ),
        ):
            settings = SimpleNamespace(archive_dir=Path(tmp), network_proxy_url=SecretStr(PROXY))
            self.assertEqual(
                run_cookie_check(settings, "synthetic cookies"),
                ("error", "network_error", "cookie_check_timeout"),
            )
            self.assertEqual(list((Path(tmp) / "state").iterdir()), [])

    def test_proxy_failures_are_network_errors_and_retryable(self) -> None:
        for failure in (
            "HTTP Error 407: Proxy Authentication Required",
            "ProxyError: authentication failed",
            "Tunnel connection failed: 403 Forbidden",
            "Cannot connect to proxy: connection refused",
            "Connection timed out",
        ):
            with self.subTest(failure=failure):
                self.assertEqual(classify_x_error(failure), ErrorCategory.NETWORK_ERROR)
                details = classify_missing_tweets(
                    [{"tweet_id": "123", "url": "https://x.com/example/status/123"}], 1, failure
                )
                self.assertEqual(details["123"]["status"], "failed_retryable")
                self.assertEqual(details["123"]["category"], "network_error")
        self.assertEqual(
            classify_x_error("HTTP Error 401: Unauthorized"), ErrorCategory.AUTH_REQUIRED
        )

    def test_zero_exit_proxy_failure_discards_partial_scan_output(self) -> None:
        with (
            patch("xarchiver.services.sources.shutil.which", return_value="gallery-dl"),
            patch(
                "xarchiver.services.sources.subprocess.run",
                return_value=SimpleNamespace(
                    returncode=0,
                    stdout='[[2, {"tweet_id": 123}]]',
                    stderr=f"[twitter][error] 407 Proxy Authentication Required: {PROXY}",
                ),
            ),
        ):
            records, meta = discover_records_with_gallery_dl(
                "https://x.com/example/media", 1, 20, network_proxy_url=PROXY
            )
        self.assertEqual(records, [])
        self.assertEqual(meta["error_category"], "network_error")
        self.assertNotIn("proxy-password", str(meta))

    def test_scan_passes_proxy_and_preserves_cursor_on_failure(self) -> None:
        cursor = {"next_start_index": 21, "last_completed": False}
        settings = SimpleNamespace(
            source_scan_sleep_min_seconds=0,
            source_scan_sleep_max_seconds=0,
            source_scan_http_timeout_seconds=15,
            source_scan_http_retries=2,
            network_proxy_url=SecretStr(PROXY),
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
                        "error_message": "proxy failed",
                    },
                ),
            ) as discover,
            patch("xarchiver.services.sources.prepare_cookies", return_value=None),
            patch("xarchiver.services.sources.update_source_cursor") as update_cursor,
            patch("xarchiver.services.sources.mark_source_scan_result"),
            patch("xarchiver.services.sources.finish_source_scan_run") as finish,
        ):
            result = scan_source(1, 20, settings=settings, session_mode="history")
        self.assertEqual(discover.call_args.kwargs["network_proxy_url"], settings.network_proxy_url)
        self.assertFalse(result["completed"])
        update_cursor.assert_not_called()
        self.assertEqual(finish.call_args.kwargs["cursor_after"], cursor)

    def test_scan_exception_summary_hides_proxy_credentials(self) -> None:
        with ExitStack() as stack:
            stack.enter_context(
                patch(
                    "xarchiver.services.sources.get_source",
                    return_value={
                        "status": "active",
                        "source_type": "user_media",
                        "source_url": "https://x.com/example/media",
                        "cursor_state": {},
                    },
                )
            )
            stack.enter_context(
                patch("xarchiver.services.sources.start_source_scan_run", return_value=9)
            )
            stack.enter_context(
                patch("xarchiver.services.sources.prepare_cookies", return_value=None)
            )
            stack.enter_context(
                patch(
                    "xarchiver.services.sources.discover_records_with_gallery_dl",
                    side_effect=subprocess.TimeoutExpired(["gallery-dl", "--proxy", PROXY], 15),
                )
            )
            stack.enter_context(patch("xarchiver.services.sources.append_source_scan_log"))
            mark = stack.enter_context(patch("xarchiver.services.sources.mark_source_scan_result"))
            finish = stack.enter_context(patch("xarchiver.services.sources.finish_source_scan_run"))
            with self.assertRaises(subprocess.TimeoutExpired):
                scan_source(1, 20, settings=self.settings(PROXY))
            self.assertNotIn("proxy-password", mark.call_args.kwargs["error_message"])
            self.assertNotIn("proxy-password", finish.call_args.kwargs["error_message"])

    def test_logs_redact_url_userinfo_and_proxy_authorization(self) -> None:
        value = f"ProxyError at {PROXY}\nProxy-Authorization: Basic encoded-secret\n"
        redacted = redact_sensitive_text(value)
        self.assertNotIn("proxy-user", redacted)
        self.assertNotIn("proxy-password", redacted)
        self.assertNotIn("encoded-secret", redacted)
        entry = build_log_entry(
            "error",
            "network",
            redacted,
            raw=redacted,
            context={"proxy": PROXY},
            exception=subprocess.TimeoutExpired(["gallery-dl", PROXY], 15),
        )
        self.assertNotIn("proxy-password", json.dumps(entry))
        record = logging.LogRecord("xarchiver", logging.ERROR, __file__, 1, value, (), None)
        record.details = {"proxy": PROXY}
        error = subprocess.TimeoutExpired(["gallery-dl", "--proxy", PROXY], 15)
        record.exc_info = (type(error), error, None)
        formatted = JsonLogFormatter().format(record)
        self.assertNotIn("proxy-password", formatted)
        self.assertNotIn("encoded-secret", formatted)
        json.loads(formatted)

    def test_redaction_hides_complete_userinfo_with_multiple_at_signs(self) -> None:
        for value in (
            "http://proxy-user:proxy-password@tail@mihomo:7890",
            "http://proxy-user:proxy-password%40tail@mihomo:7890",
            "http://proxy-user:proxy-password'tail@mihomo:7890",
        ):
            with self.subTest(value=value):
                self.assertEqual(redact_sensitive_text(value), "http://[redacted]@mihomo:7890")

    def test_cli_invalid_proxy_reports_safe_configuration_error(self) -> None:
        environment = dict(
            os.environ,
            DATABASE_URL="postgresql://xarchiver@localhost/xarchiver_test",
            NETWORK_PROXY_URL="socks5://proxy-user:proxy-password@mihomo:7890",
        )
        result = subprocess.run(
            [sys.executable, "-m", "xarchiver.cli", "status"],
            env=environment,
            capture_output=True,
            text=True,
            check=False,
            timeout=10,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("NETWORK_PROXY_URL", result.stderr)
        self.assertNotIn("proxy-password", result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()
