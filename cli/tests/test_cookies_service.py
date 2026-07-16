import stat
import subprocess
import tempfile
import unittest
from datetime import UTC, datetime, timedelta
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from xarchiver.core.errors import ArchiverError
from xarchiver.db import connect
from xarchiver.services.cookies import (
    CookieInspection,
    check_cookie_config,
    classify_cookie_check_error,
    clear_cookie_content,
    cookie_content_sha256,
    get_cookie_config,
    inspect_cookie_content,
    persist_cookie_validation,
    resolve_cookie_content,
    run_cookie_check,
    save_cookie_content,
)


def cookie_fixture(
    *,
    auth_expires: int = 0,
    ct0_expires: int = 0,
    http_only: bool = False,
) -> str:
    domain = "#HttpOnly_.x.com" if http_only else ".x.com"
    return "\n".join(
        [
            "# Netscape HTTP Cookie File",
            f"{domain}\tTRUE\t/\tTRUE\t{auth_expires}\tauth_token\tauth-secret",
            f".x.com\tTRUE\t/\tTRUE\t{ct0_expires}\tct0\tcsrf-secret",
        ]
    )


class CookieParsingTests(unittest.TestCase):
    def test_inspect_accepts_session_cookies_and_http_only_prefix(self) -> None:
        inspection = inspect_cookie_content(cookie_fixture(http_only=True))

        self.assertIsNone(inspection.auth_token_expires_at)
        self.assertEqual(
            inspection.content_sha256,
            cookie_content_sha256(cookie_fixture(http_only=True)),
        )

    def test_inspect_reports_declared_auth_expiry(self) -> None:
        expires = int((datetime.now(UTC) + timedelta(days=1)).timestamp())

        inspection = inspect_cookie_content(cookie_fixture(auth_expires=expires))

        self.assertEqual(inspection.auth_token_expires_at, datetime.fromtimestamp(expires, tz=UTC))

    def test_inspect_rejects_expired_required_cookies(self) -> None:
        expired = int((datetime.now(UTC) - timedelta(minutes=1)).timestamp())

        for content, code in (
            (cookie_fixture(auth_expires=expired), "cookie_auth_token_expired"),
            (cookie_fixture(ct0_expires=expired), "cookie_ct0_expired"),
        ):
            with self.subTest(code=code), self.assertRaises(ArchiverError) as error:
                inspect_cookie_content(content)
            self.assertEqual(error.exception.code, code)

    def test_inspect_rejects_malformed_or_incomplete_content(self) -> None:
        cases = [
            ("not-a-netscape-row", "cookie_netscape_format_invalid"),
            (".x.com\tTRUE\t/\tTRUE\tnever\tauth_token\tvalue", "cookie_expiration_invalid"),
            (".example.com\tTRUE\t/\tTRUE\t0\tauth_token\tvalue", "cookie_x_domain_missing"),
            (
                ".x.com\tTRUE\t/\tTRUE\t0\tct0\tcsrf",
                "cookie_auth_token_missing",
            ),
            (
                ".x.com\tTRUE\t/\tTRUE\t0\tauth_token\tauth",
                "cookie_ct0_missing",
            ),
        ]

        for content, code in cases:
            with self.subTest(code=code), self.assertRaises(ArchiverError) as error:
                inspect_cookie_content(content)
            self.assertEqual(error.exception.code, code)

    def test_inspect_rejects_content_larger_than_one_megabyte(self) -> None:
        oversized = cookie_fixture() + "\n# " + ("x" * (1024 * 1024))

        with self.assertRaises(ArchiverError) as error:
            inspect_cookie_content(oversized)

        self.assertEqual(error.exception.code, "cookie_content_too_large")


class CookieCheckUnitTests(unittest.TestCase):
    def settings(self, archive_dir: Path) -> SimpleNamespace:
        return SimpleNamespace(
            archive_dir=archive_dir,
            cookie_file=archive_dir / "missing-cookies.txt",
            source_scan_http_timeout_seconds=15,
            source_scan_http_retries=2,
        )

    def test_run_cookie_check_accepts_empty_bookmarks_success(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            archive_dir = Path(tmp)
            completed = SimpleNamespace(
                returncode=0,
                stderr=(
                    "[urllib3.connectionpool][debug] Starting new HTTPS connection (1): "
                    "x.com:443\n[twitter][info] No results"
                ),
            )
            observed_mode: list[int] = []

            def complete_check(command, **_kwargs):
                cookie_option = next(
                    value for value in command if "extractor.twitter.cookies=" in value
                )
                cookie_path = Path(cookie_option.split("=", 1)[1])
                observed_mode.append(stat.S_IMODE(cookie_path.stat().st_mode))
                return completed

            with (
                patch("xarchiver.services.cookies.shutil.which", return_value="/usr/bin/gallery-dl"),
                patch(
                    "xarchiver.services.cookies.subprocess.run",
                    side_effect=complete_check,
                ) as run,
            ):
                result = run_cookie_check(self.settings(archive_dir), cookie_fixture())

            command = run.call_args.args[0]
            cookie_option = next(value for value in command if "extractor.twitter.cookies=" in value)
            cookie_path = Path(cookie_option.split("=", 1)[1])

        self.assertEqual(result, ("valid", None, "cookie_check_valid"))
        self.assertEqual(observed_mode, [0o600])
        self.assertFalse(cookie_path.exists())
        self.assertIn("extractor.twitter.cookies-update=false", command)
        self.assertIn("extractor.twitter.ratelimit=abort", command)
        self.assertEqual(run.call_args.kwargs["stdout"], subprocess.DEVNULL)

    def test_cookie_check_ignores_normal_verbose_connection_log(self) -> None:
        stderr = (
            "[twitter][debug] cookies: Loading cookies from '/tmp/cookies.txt'\n"
            "[urllib3.connectionpool][debug] Starting new HTTPS connection (1): x.com:443"
        )

        self.assertIsNone(classify_cookie_check_error(stderr, 0))

    def test_run_cookie_check_classifies_auth_network_and_rate_limit(self) -> None:
        cases = [
            (
                "[twitter][error] 401 Unauthorized",
                "invalid",
                "auth_required",
                "cookie_check_auth_required",
            ),
            ("Read timed out. (3/3)", "error", "network_error", "cookie_check_network_error"),
            (
                "[twitter][error] 429 rate limit",
                "error",
                "rate_limited",
                "cookie_check_rate_limited",
            ),
        ]
        with tempfile.TemporaryDirectory() as tmp:
            settings = self.settings(Path(tmp))
            for stderr, status, category, message in cases:
                completed = SimpleNamespace(returncode=0, stderr=stderr)
                with (
                    self.subTest(stderr=stderr),
                    patch(
                        "xarchiver.services.cookies.shutil.which",
                        return_value="/usr/bin/gallery-dl",
                    ),
                    patch("xarchiver.services.cookies.subprocess.run", return_value=completed),
                ):
                    self.assertEqual(
                        run_cookie_check(settings, cookie_fixture()),
                        (status, category, message),
                    )

    def test_run_cookie_check_handles_timeout_and_missing_command(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            settings = self.settings(Path(tmp))
            with patch("xarchiver.services.cookies.shutil.which", return_value=None):
                self.assertEqual(
                    run_cookie_check(settings, cookie_fixture()),
                    ("error", "command_not_found", "cookie_check_command_not_found"),
                )
            with (
                patch("xarchiver.services.cookies.shutil.which", return_value="/usr/bin/gallery-dl"),
                patch(
                    "xarchiver.services.cookies.subprocess.run",
                    side_effect=subprocess.TimeoutExpired(["gallery-dl"], 60),
                ),
            ):
                self.assertEqual(
                    run_cookie_check(settings, cookie_fixture()),
                    ("error", "network_error", "cookie_check_timeout"),
                )
            self.assertEqual(list((Path(tmp) / "state").glob("cookie-check-*")), [])

    def test_check_cookie_config_rejects_concurrent_check(self) -> None:
        fake_lock = SimpleNamespace(acquire=lambda blocking: False)
        with patch("xarchiver.services.cookies.cookie_check_lock", fake_lock):
            with self.assertRaises(ArchiverError) as error:
                check_cookie_config(self.settings(Path("/tmp/archive")))

        self.assertEqual(error.exception.code, "cookie_check_in_progress")


class CookieServiceIntegrationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.clear_db_cookie()

    def tearDown(self) -> None:
        self.clear_db_cookie()

    def clear_db_cookie(self) -> None:
        with connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    create table if not exists cookie_config (
                      id smallint primary key default 1,
                      content text,
                      label text,
                      updated_at timestamptz not null default now(),
                      constraint chk_cookie_config_singleton check (id = 1)
                    )
                    """
                )
                cur.execute(
                    """
                    alter table cookie_config
                      add column if not exists validation_status text not null default 'unchecked',
                      add column if not exists validated_at timestamptz,
                      add column if not exists auth_token_expires_at timestamptz,
                      add column if not exists validation_error_category text,
                      add column if not exists validation_message text,
                      add column if not exists validated_content_sha256 text
                    """
                )
                cur.execute(
                    """
                    insert into cookie_config (id, content, label, updated_at)
                    values (1, null, null, now())
                    on conflict (id) do update
                    set content = null,
                        label = null,
                        updated_at = now(),
                        validation_status = 'unchecked',
                        validated_at = null,
                        auth_token_expires_at = null,
                        validation_error_category = null,
                        validation_message = null,
                        validated_content_sha256 = null
                    """
                )
            conn.commit()

    def test_get_cookie_config_reports_none_without_db_or_file(self) -> None:
        settings = SimpleNamespace(cookie_file=Path("missing-cookies.txt"))

        status = get_cookie_config(settings)

        self.assertFalse(status["configured"])
        self.assertEqual(status["source"], "none")
        self.assertEqual(status["validation_status"], "unchecked")
        self.assertIsNone(resolve_cookie_content(settings))

    def test_resolve_cookie_content_uses_file_fallback(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            cookie_file = Path(tmp) / "cookies.txt"
            cookie_file.write_text(cookie_fixture(), encoding="utf-8")
            settings = SimpleNamespace(cookie_file=cookie_file)

            status = get_cookie_config(settings)
            content = resolve_cookie_content(settings)

        self.assertTrue(status["configured"])
        self.assertEqual(status["source"], "file")
        self.assertEqual(status["validation_status"], "unchecked")
        self.assertIsNotNone(content)
        self.assertEqual(content.source, "file")

    def test_save_prefers_database_and_resets_validation(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            cookie_file = Path(tmp) / "cookies.txt"
            cookie_file.write_text(cookie_fixture(), encoding="utf-8")
            settings = SimpleNamespace(cookie_file=cookie_file)

            save_cookie_content(cookie_fixture(), "db label")
            status = get_cookie_config(settings)
            content = resolve_cookie_content(settings)

        self.assertEqual(status["source"], "database")
        self.assertEqual(status["label"], "db label")
        self.assertEqual(status["validation_status"], "unchecked")
        self.assertEqual(status["validation_message"], "cookie_not_checked")
        self.assertIsNotNone(content)
        self.assertEqual(content.source, "database")

    def test_save_rejects_invalid_content_without_replacing_existing_cookie(self) -> None:
        save_cookie_content(cookie_fixture(), "valid")

        with self.assertRaises(ArchiverError):
            save_cookie_content("invalid", "invalid")

        content = resolve_cookie_content(SimpleNamespace(cookie_file=Path("missing.txt")))
        self.assertIsNotNone(content)
        self.assertEqual(content.label, "valid")

    def test_clear_cookie_content_falls_back_to_file_and_invalidates_result(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            cookie_file = Path(tmp) / "cookies.txt"
            cookie_file.write_text(cookie_fixture(), encoding="utf-8")
            settings = SimpleNamespace(cookie_file=cookie_file)

            save_cookie_content(cookie_fixture(), "db label")
            status = clear_cookie_content(settings)

        self.assertEqual(status["source"], "file")
        self.assertEqual(status["validation_status"], "unchecked")

    def test_persist_validation_rejects_changed_cookie_fingerprint(self) -> None:
        settings = SimpleNamespace(cookie_file=Path("missing.txt"))
        original = cookie_fixture()
        save_cookie_content(original, "first")
        inspection = CookieInspection(cookie_content_sha256(original), None)
        changed = original.replace("auth-secret", "changed-secret")
        save_cookie_content(changed, "changed")

        with self.assertRaises(ArchiverError) as error:
            persist_cookie_validation(
                settings,
                inspection,
                status="valid",
                error_category=None,
                message="cookie_check_valid",
            )

        self.assertEqual(error.exception.code, "cookie_config_changed")

    def test_check_persists_safe_result_without_exposing_hash_or_content(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            settings = SimpleNamespace(
                archive_dir=Path(tmp),
                cookie_file=Path(tmp) / "missing.txt",
                source_scan_http_timeout_seconds=15,
                source_scan_http_retries=2,
            )
            save_cookie_content(cookie_fixture(), "test")
            with patch(
                "xarchiver.services.cookies.run_cookie_check",
                return_value=("invalid", "auth_required", "cookie_check_auth_required"),
            ):
                status = check_cookie_config(settings)

        self.assertEqual(status["validation_status"], "invalid")
        self.assertEqual(status["validation_error_category"], "auth_required")
        self.assertNotIn("content", status)
        self.assertNotIn("validated_content_sha256", status)

    def test_check_records_expired_file_cookie_without_remote_request(self) -> None:
        expired = int((datetime.now(UTC) - timedelta(minutes=1)).timestamp())
        with tempfile.TemporaryDirectory() as tmp:
            cookie_file = Path(tmp) / "cookies.txt"
            cookie_file.write_text(
                cookie_fixture(auth_expires=expired),
                encoding="utf-8",
            )
            settings = SimpleNamespace(
                archive_dir=Path(tmp) / "archive",
                cookie_file=cookie_file,
                source_scan_http_timeout_seconds=15,
                source_scan_http_retries=2,
            )
            with patch("xarchiver.services.cookies.run_cookie_check") as remote_check:
                status = check_cookie_config(settings)

        remote_check.assert_not_called()
        self.assertEqual(status["validation_status"], "expired")
        self.assertIsNotNone(status["validated_at"])
        self.assertEqual(status["validation_message"], "cookie_auth_token_expired")


if __name__ == "__main__":
    unittest.main()
