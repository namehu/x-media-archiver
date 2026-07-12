import asyncio
import time
import unittest
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import patch

import psycopg
from fastapi import HTTPException, Request, Response
from fastapi.responses import JSONResponse

from xarchiver.api.middleware import AuthMiddleware
from xarchiver.api.v1 import auth as auth_routes
from xarchiver.services import auth


class FakeCursor:
    def __init__(self, row=None, execute_error=None):
        self.row = row
        self.execute_error = execute_error
        self.executions = []

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return None

    def execute(self, sql, params=None):
        if self.execute_error:
            raise self.execute_error
        self.executions.append((sql, params or {}))

    def fetchone(self):
        row, self.row = self.row, None
        return row


class FakeConnection:
    def __init__(self, row=None, execute_error=None):
        self.cursor_value = FakeCursor(row, execute_error)
        self.commits = 0

    def cursor(self):
        return self.cursor_value

    def commit(self):
        self.commits += 1


@contextmanager
def fake_connect(connection):
    yield connection


class AuthServiceTests(unittest.TestCase):
    def test_validation_and_token_hashing(self):
        self.assertEqual(auth.validate_username(" admin_1 "), "admin_1")
        self.assertNotEqual(auth.hash_token("secret-token"), "secret-token")
        with self.assertRaisesRegex(auth.AuthError, "invalid_username"):
            auth.validate_username("not allowed")
        with self.assertRaisesRegex(auth.AuthError, "invalid_password"):
            auth.validate_password("too-short")

    def test_setup_token_is_required_and_rotates(self):
        settings = SimpleNamespace(auth_mode="password")
        with patch("xarchiver.services.auth.get_admin", return_value=None):
            first = auth.initialize_setup_token(settings)
            second = auth.initialize_setup_token(settings)
        self.assertIsNotNone(first)
        self.assertIsNotNone(second)
        self.assertNotEqual(first, second)
        with self.assertRaisesRegex(auth.AuthError, "invalid_setup_token"):
            auth.create_admin("wrong-token-value-that-is-long", "admin", "long-enough-password")

    def test_concurrent_admin_insert_maps_psycopg_integrity_error_to_conflict(self):
        settings = SimpleNamespace(auth_mode="password")
        with patch("xarchiver.services.auth.get_admin", return_value=None):
            setup_token = auth.initialize_setup_token(settings)
        connection = FakeConnection(execute_error=psycopg.errors.UniqueViolation("duplicate"))
        with patch(
            "xarchiver.services.auth.connect", side_effect=lambda: fake_connect(connection)
        ):
            with self.assertRaisesRegex(auth.AuthError, "admin_already_initialized"):
                auth.create_admin(setup_token, "admin", "long-enough-password")

    def test_session_token_is_only_sent_to_database_as_hash(self):
        connection = FakeConnection()
        settings = SimpleNamespace(auth_session_ttl_hours=168)
        with patch("xarchiver.services.auth.connect", side_effect=lambda: fake_connect(connection)):
            token = auth.create_session(settings)

        all_values = [value for _, params in connection.cursor_value.executions for value in params.values()]
        self.assertNotIn(token, all_values)
        self.assertIn(auth.hash_token(token), all_values)

    def test_expired_session_is_rejected_and_deleted(self):
        token = "expired-session-token"
        connection = FakeConnection(
            {
                "id": 1,
                "username": "admin",
                "last_seen_at": datetime.now(UTC) - timedelta(days=2),
                "expires_at": datetime.now(UTC) - timedelta(seconds=1),
            }
        )
        with patch("xarchiver.services.auth.connect", side_effect=lambda: fake_connect(connection)):
            self.assertIsNone(auth.authenticate_session(token))

        self.assertGreaterEqual(len(connection.cursor_value.executions), 2)
        self.assertIn(auth.hash_token(token), connection.cursor_value.executions[-1][1].values())


class AuthMiddlewareTests(unittest.TestCase):
    def make_request(self, path, method="GET", headers=None):
        raw_headers = [(key.lower().encode(), value.encode()) for key, value in (headers or {}).items()]
        return Request(
            {
                "type": "http",
                "method": method,
                "scheme": "http",
                "path": path,
                "query_string": b"",
                "headers": raw_headers,
                "client": ("127.0.0.1", 12345),
                "server": ("127.0.0.1", 18000),
            }
        )

    def settings(self, mode="password"):
        return SimpleNamespace(auth_mode=mode)

    def test_health_and_session_are_public_but_business_api_is_protected(self):
        async def call_next(_request):
            return JSONResponse({"ok": True})

        middleware = AuthMiddleware(app=lambda *_args: None)
        with patch("xarchiver.api.middleware.get_settings", return_value=self.settings()):
            health = asyncio.run(middleware.dispatch(self.make_request("/health"), call_next))
            session = asyncio.run(
                middleware.dispatch(self.make_request("/api/v1/auth/session"), call_next)
            )
            protected = asyncio.run(
                middleware.dispatch(self.make_request("/api/v1/library/summary"), call_next)
            )

        self.assertEqual(health.status_code, 200)
        self.assertEqual(session.status_code, 200)
        self.assertEqual(protected.status_code, 401)

    def test_authenticated_write_requires_matching_origin(self):
        async def call_next(_request):
            return JSONResponse({"ok": True})

        middleware = AuthMiddleware(app=lambda *_args: None)
        base_headers = {"host": "127.0.0.1:18000", "cookie": "xma_session=test-token"}
        with (
            patch("xarchiver.api.middleware.get_settings", return_value=self.settings()),
            patch("xarchiver.api.middleware.authenticate_session", return_value={"id": 1, "username": "admin"}),
        ):
            rejected = asyncio.run(
                middleware.dispatch(
                    self.make_request("/api/v1/actions/requeue", "POST", base_headers), call_next
                )
            )
            accepted = asyncio.run(
                middleware.dispatch(
                    self.make_request(
                        "/api/v1/actions/requeue",
                        "POST",
                        {**base_headers, "origin": "http://127.0.0.1:5173"},
                    ),
                    call_next,
                )
            )
            evil_origin = asyncio.run(
                middleware.dispatch(
                    self.make_request(
                        "/api/v1/actions/requeue",
                        "POST",
                        {**base_headers, "origin": "https://evil.example"},
                    ),
                    call_next,
                )
            )

        self.assertEqual(rejected.status_code, 403)
        self.assertEqual(accepted.status_code, 200)
        self.assertEqual(evil_origin.status_code, 403)

    def test_static_asset_with_cookie_does_not_query_session_database(self):
        async def call_next(_request):
            return JSONResponse({"ok": True})

        middleware = AuthMiddleware(app=lambda *_args: None)
        with (
            patch("xarchiver.api.middleware.get_settings", return_value=self.settings()),
            patch("xarchiver.api.middleware.authenticate_session") as authenticate,
        ):
            response = asyncio.run(
                middleware.dispatch(
                    self.make_request(
                        "/assets/index.js",
                        headers={"host": "127.0.0.1:18000", "cookie": "xma_session=test-token"},
                    ),
                    call_next,
                )
            )

        self.assertEqual(response.status_code, 200)
        authenticate.assert_not_called()

    def test_auth_database_failure_returns_service_unavailable(self):
        async def call_next(_request):
            return JSONResponse({"ok": True})

        middleware = AuthMiddleware(app=lambda *_args: None)
        with (
            patch("xarchiver.api.middleware.get_settings", return_value=self.settings()),
            patch(
                "xarchiver.api.middleware.authenticate_session",
                side_effect=psycopg.OperationalError("database unavailable"),
            ),
        ):
            response = asyncio.run(
                middleware.dispatch(
                    self.make_request(
                        "/api/v1/library/summary",
                        headers={"host": "127.0.0.1:18000", "cookie": "xma_session=test-token"},
                    ),
                    call_next,
                )
            )

        self.assertEqual(response.status_code, 503)

    def test_disabled_mode_bypasses_protection(self):
        async def call_next(_request):
            return JSONResponse({"ok": True})

        middleware = AuthMiddleware(app=lambda *_args: None)
        with patch("xarchiver.api.middleware.get_settings", return_value=self.settings("disabled")):
            response = asyncio.run(
                middleware.dispatch(self.make_request("/api/v1/library/summary"), call_next)
            )
        self.assertEqual(response.status_code, 200)


class AuthRouteTests(unittest.TestCase):
    def test_authenticated_session_reuses_middleware_result_without_admin_query(self):
        request = Request(
            {
                "type": "http",
                "method": "GET",
                "scheme": "http",
                "path": "/api/v1/auth/session",
                "query_string": b"",
                "headers": [],
            }
        )
        request.state.auth_admin = {"id": 1, "username": "admin"}
        settings = SimpleNamespace(auth_mode="password")
        with (
            patch("xarchiver.api.v1.auth.get_settings", return_value=settings),
            patch("xarchiver.api.v1.auth.get_admin") as get_admin,
        ):
            result = auth_routes.session(request)

        self.assertEqual(result["status"], "authenticated")
        get_admin.assert_not_called()

    def test_auth_database_errors_map_to_service_unavailable(self):
        with self.assertRaises(HTTPException) as error:
            auth_routes._db_call(
                lambda: (_ for _ in ()).throw(psycopg.OperationalError("unavailable"))
            )

        self.assertEqual(error.exception.status_code, 503)
        self.assertEqual(error.exception.detail, "authentication_unavailable")


class LoginRateLimitTests(unittest.TestCase):
    def setUp(self):
        with auth_routes._failed_login_lock:
            auth_routes._failed_logins.clear()

    def tearDown(self):
        with auth_routes._failed_login_lock:
            auth_routes._failed_logins.clear()

    def test_five_failures_trigger_rate_limit(self):
        key = "test-client:admin"
        auth_routes._clear_failures(key)
        for _ in range(5):
            auth_routes._record_failure(key)
        self.assertTrue(auth_routes._is_rate_limited(key))

    def test_normal_failure_flow_never_exceeds_tracked_client_capacity(self):
        for index in range(auth_routes._MAX_TRACKED_CLIENTS + 10):
            key = f"client-{index}"
            self.assertFalse(auth_routes._is_rate_limited(key))
            auth_routes._record_failure(key)

        self.assertLessEqual(
            len(auth_routes._failed_logins), auth_routes._MAX_TRACKED_CLIENTS
        )
        self.assertIn(f"client-{auth_routes._MAX_TRACKED_CLIENTS + 9}", auth_routes._failed_logins)

    def test_expired_client_entries_are_removed_during_failure_recording(self):
        expired_at = time.monotonic() - auth_routes._FAILURE_WINDOW_SECONDS - 1
        with auth_routes._failed_login_lock:
            auth_routes._failed_logins["expired-client"] = [expired_at]

        auth_routes._record_failure("current-client")

        self.assertNotIn("expired-client", auth_routes._failed_logins)
        self.assertIn("current-client", auth_routes._failed_logins)

    def test_session_cookie_uses_secure_browser_flags(self):
        response = Response()
        settings = SimpleNamespace(auth_cookie_secure=True, auth_session_ttl_hours=168)
        with patch("xarchiver.api.v1.auth.get_settings", return_value=settings):
            auth_routes._set_session_cookie(response, "plain-browser-token")

        cookie = response.headers["set-cookie"]
        self.assertIn("xma_session=plain-browser-token", cookie)
        self.assertIn("HttpOnly", cookie)
        self.assertIn("Secure", cookie)
        self.assertIn("SameSite=strict", cookie)
        self.assertIn("Max-Age=604800", cookie)


if __name__ == "__main__":
    unittest.main()
