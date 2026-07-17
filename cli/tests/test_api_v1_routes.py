import unittest
from datetime import UTC, datetime
from unittest.mock import patch

from api_route_helpers import iter_app_routes
from fastapi import HTTPException

from xarchiver.api.app import create_app
from xarchiver.api.schemas import (
    ArchiveRunsPageResponse,
    ArchiveSourceDetailResponse,
    BackfillRequest,
    SourceCreateRequest,
    SourceDiscoveryPageResponse,
    SourcePinRequest,
    SourceScanRunsPageResponse,
    SourcesPageResponse,
    SourceStatusRequest,
    UpdateCookiesRequest,
    VerifyRequest,
)
from xarchiver.row_models import ArchiveRunRow, ArchiveSourceListRow


class V1RouterSmokeTests(unittest.TestCase):
    """Verify that canonical /api/v1/* routes are registered and wired correctly."""

    def setUp(self):
        self.app = create_app()
        self.get_paths = {
            route.path: route.endpoint
            for route in iter_app_routes(self.app)
            if "GET" in getattr(route, "methods", set())
        }
        self.post_paths = {
            route.path: route.endpoint
            for route in iter_app_routes(self.app)
            if "POST" in getattr(route, "methods", set())
        }
        self.delete_paths = {
            route.path: route.endpoint
            for route in iter_app_routes(self.app)
            if "DELETE" in getattr(route, "methods", set())
        }

    # ── Route registration ─────────────────────────────────────────────────────

    def test_v1_get_routes_registered(self):
        expected = [
            "/api/v1/library/summary",
            "/api/v1/library/media",
            "/api/v1/library/tweets/{tweet_id}",
            "/api/v1/library/failures",
            "/api/v1/library/duplicates",
            "/api/v1/archive-runs",
            "/api/v1/archive-runs/{run_id}",
            "/api/v1/sources",
            "/api/v1/sources/{source_id}",
            "/api/v1/sources/{source_id}/discovered",
            "/api/v1/sources/{source_id}/scan-runs",
            "/api/v1/events",
            "/api/v1/settings/download-policy",
            "/api/v1/settings/cookies",
            "/api/v1/health/detail",
            "/api/v1/media-file/{relative_path:path}",
            "/api/v1/auth/session",
        ]
        for path in expected:
            self.assertIn(path, self.get_paths, f"GET {path} not registered")

    def test_v1_post_routes_registered(self):
        expected = [
            "/api/v1/archive-runs",
            "/api/v1/archive-runs/{run_id}/retry",
            "/api/v1/sources",
            "/api/v1/sources/{source_id}/records",
            "/api/v1/sources/{source_id}/submit-discovered",
            "/api/v1/sources/{source_id}/status",
            "/api/v1/sources/{source_id}/pin",
            "/api/v1/sources/{source_id}/scan",
            "/api/v1/sources/{source_id}/history-scan",
            "/api/v1/sources/{source_id}/scan-sessions",
            "/api/v1/sources/{source_id}/scan-sessions/pause",
            "/api/v1/sources/{source_id}/scan-sessions/resume",
            "/api/v1/sources/{source_id}/scan-sessions/stop",
            "/api/v1/sources/{source_id}/history-scan/stop",
            "/api/v1/actions/verify",
            "/api/v1/actions/requeue",
            "/api/v1/actions/recover-interrupted",
            "/api/v1/actions/export",
            "/api/v1/maintenance/backfill",
            "/api/v1/maintenance/verify",
            "/api/v1/settings/cookies",
            "/api/v1/settings/cookies/check",
            "/api/v1/auth/setup",
            "/api/v1/auth/login",
            "/api/v1/auth/logout",
            "/api/v1/auth/password",
        ]
        for path in expected:
            self.assertIn(path, self.post_paths, f"POST {path} not registered")

    def test_v1_delete_routes_registered(self):
        self.assertIn("/api/v1/settings/cookies", self.delete_paths)

    # ── Error parity: v1 endpoints enforce same guards as legacy ──────────────

    def test_v1_full_scan_endpoints_reject_unconfirmed(self):
        for path, req in (
            ("/api/v1/maintenance/backfill", BackfillRequest()),
            ("/api/v1/maintenance/verify", VerifyRequest()),
            ("/api/v1/actions/verify", VerifyRequest()),
        ):
            with self.assertRaises(HTTPException) as ctx:
                self.post_paths[path](req)
            self.assertEqual(ctx.exception.status_code, 400, f"{path} should reject unconfirmed")
            self.assertEqual(ctx.exception.detail, "full_scan_confirmation_required")

    def test_v1_source_create_rejects_invalid_url(self):
        with self.assertRaises(HTTPException) as ctx:
            self.post_paths["/api/v1/sources"](
                SourceCreateRequest(source_type="profile", source_url="https://example.com/user")
            )
        self.assertEqual(ctx.exception.status_code, 400)

    def test_v1_source_status_maps_not_found_to_404(self):
        with patch("xarchiver.api.v1.sources.update_source_status", side_effect=ValueError("source_not_found")):
            with self.assertRaises(HTTPException) as ctx:
                self.post_paths["/api/v1/sources/{source_id}/status"](
                    999, SourceStatusRequest(status="paused")
                )
        self.assertEqual(ctx.exception.status_code, 404)

    def test_v1_archive_runs_list_delegates_all_filters(self):
        page = {"rows": [], "count": 0, "total_count": 0, "limit": 10, "offset": 20}
        with patch("xarchiver.api.v1.archive_runs.list_runs_page", return_value=page) as mock:
            result = self.get_paths["/api/v1/archive-runs"](
                limit=10, offset=20, run_status="queued", tweet_id="123", failed_only=True
            )
        self.assertEqual(result, page)
        mock.assert_called_once_with(limit=10, offset=20, status="queued", tweet_id="123", failed_only=True)

    def test_v1_archive_runs_response_serializes_row_models(self):
        row = ArchiveRunRow.model_validate(
            {
                "id": 1,
                "trigger_type": "manual",
                "status": "queued",
                "started_at": datetime(2026, 1, 1, tzinfo=UTC),
                "finished_at": None,
                "result": {"tasks": {"queued_count": 1}},
                "error_message": None,
            }
        )
        page = {"rows": [row], "count": 1, "total_count": 1, "limit": 10, "offset": 0}

        with patch("xarchiver.api.v1.archive_runs.list_runs_page", return_value=page):
            result = self.get_paths["/api/v1/archive-runs"](limit=10)

        payload = ArchiveRunsPageResponse.model_validate(result).model_dump(mode="json")
        self.assertEqual(payload["rows"][0]["id"], 1)
        self.assertEqual(payload["rows"][0]["result"]["tasks"]["queued_count"], 1)

    def test_v1_sources_list_delegates_all_filters(self):
        page = {"rows": [], "count": 0, "total_count": 0, "limit": 5, "offset": 0}
        with patch("xarchiver.api.v1.sources.list_sources_page", return_value=page) as mock:
            result = self.get_paths["/api/v1/sources"](
                limit=5,
                offset=0,
                source_status="active",
                source_type="profile",
                sort_by="created_at",
                sort_direction="asc",
            )
        self.assertEqual(result, page)
        mock.assert_called_once_with(
            status="active",
            source_type="profile",
            sort_by="created_at",
            sort_direction="asc",
            limit=5,
            offset=0,
        )

    def test_v1_source_pin_maps_not_found_to_404(self):
        with patch("xarchiver.api.v1.sources.update_source_pin", side_effect=ValueError("source_not_found")):
            with self.assertRaises(HTTPException) as ctx:
                self.post_paths["/api/v1/sources/{source_id}/pin"](999, SourcePinRequest(is_pinned=True))
        self.assertEqual(ctx.exception.status_code, 404)

    def test_v1_sources_response_serializes_row_models(self):
        row = ArchiveSourceListRow.model_validate(
            {
                "id": 2,
                "source_type": "profile",
                "source_url": "https://x.com/example",
                "status": "active",
                "cursor_state": {},
                "discovered_count": 0,
                "submitted_count": 0,
                "created_at": datetime(2026, 1, 1, tzinfo=UTC),
                "updated_at": datetime(2026, 1, 2, tzinfo=UTC),
                "discovered_tweet_count": 3,
                "unsubmitted_tweet_count": 2,
                "discovered_media_count": 4,
            }
        )
        page = {"rows": [row], "count": 1, "total_count": 1, "limit": 5, "offset": 0}

        with patch("xarchiver.api.v1.sources.list_sources_page", return_value=page):
            result = self.get_paths["/api/v1/sources"](limit=5)

        payload = SourcesPageResponse.model_validate(result).model_dump(mode="json")
        self.assertEqual(payload["rows"][0]["id"], 2)
        self.assertEqual(payload["rows"][0]["discovered_media_count"], 4)

    def test_v1_source_detail_response_is_slim(self):
        detail = {
            "id": 2,
            "source_type": "profile",
            "source_url": "https://x.com/example",
            "status": "active",
            "cursor_state": {},
            "discovered_count": 0,
            "submitted_count": 0,
            "created_at": datetime(2026, 1, 1, tzinfo=UTC),
            "updated_at": datetime(2026, 1, 2, tzinfo=UTC),
            "discovered_tweet_count": 3,
            "unsubmitted_tweet_count": 2,
            "discovered_media_count": 4,
            "scan_summary": {
                "batch_count": 5,
                "added_tweet_count": 3,
                "last_success_at": None,
                "last_error_at": None,
            },
            "active_scan_run": None,
        }

        with patch("xarchiver.api.v1.sources.get_source", return_value=detail):
            result = self.get_paths["/api/v1/sources/{source_id}"](2)

        payload = ArchiveSourceDetailResponse.model_validate(result).model_dump(mode="json")
        self.assertEqual(payload["scan_summary"]["batch_count"], 5)
        self.assertIn("active_scan_run", payload)
        self.assertNotIn("discovered", payload)
        self.assertNotIn("scan_runs", payload)

    def test_v1_source_discovered_delegates_pagination(self):
        page = {"rows": [], "count": 0, "total_count": 7, "limit": 25, "offset": 50}
        with patch("xarchiver.api.v1.sources.list_source_discovered_page", return_value=page) as mock:
            result = self.get_paths["/api/v1/sources/{source_id}/discovered"](2, limit=25, offset=50)

        payload = SourceDiscoveryPageResponse.model_validate(result).model_dump(mode="json")
        self.assertEqual(payload["total_count"], 7)
        mock.assert_called_once_with(2, limit=25, offset=50)

    def test_v1_source_scan_runs_delegates_pagination(self):
        page = {"rows": [], "count": 0, "total_count": 3, "limit": 20, "offset": 20}
        with patch("xarchiver.api.v1.sources.list_source_scan_runs_page", return_value=page) as mock:
            result = self.get_paths["/api/v1/sources/{source_id}/scan-runs"](2, limit=20, offset=20)

        payload = SourceScanRunsPageResponse.model_validate(result).model_dump(mode="json")
        self.assertEqual(payload["total_count"], 3)
        mock.assert_called_once_with(2, limit=20, offset=20)

    # ── OpenAPI schema: v1 routes appear in the spec ──────────────────────────

    def test_v1_routes_appear_in_openapi_spec(self):
        paths = set(self.app.openapi()["paths"].keys())
        self.assertIn("/api/v1/archive-runs", paths)
        self.assertIn("/api/v1/sources", paths)
        self.assertIn("/api/v1/sources/{source_id}/scan-sessions", paths)
        self.assertIn("/api/v1/library/media", paths)
        self.assertIn("/api/v1/actions/verify", paths)
        self.assertIn("/api/v1/health/detail", paths)
        self.assertIn("/api/v1/settings/cookies", paths)
        self.assertIn("/api/v1/auth/session", paths)

    def test_v1_cookies_endpoints_do_not_return_content(self):
        response = {
            "configured": True,
            "source": "database",
            "label": "test",
            "updated_at": None,
            "validation_status": "unchecked",
            "validated_at": None,
            "auth_token_expires_at": None,
            "validation_error_category": None,
            "validation_message": "cookie_not_checked",
        }
        with (
            patch("xarchiver.api.v1.settings.save_cookie_content") as save_mock,
            patch(
                "xarchiver.api.v1.settings.get_cookie_config",
                return_value=response,
            ),
        ):
            result = self.post_paths["/api/v1/settings/cookies"](
                UpdateCookiesRequest(content="secret-cookie-content", label="test")
            )

        save_mock.assert_called_once_with("secret-cookie-content", "test")
        self.assertNotIn("content", result)
        self.assertNotIn("validated_content_sha256", result)

    def test_v1_cookie_check_endpoint_returns_safe_status(self):
        response = {
            "configured": True,
            "source": "database",
            "label": "test",
            "updated_at": None,
            "validation_status": "valid",
            "validated_at": None,
            "auth_token_expires_at": None,
            "validation_error_category": None,
            "validation_message": "cookie_check_valid",
        }
        with patch(
            "xarchiver.api.v1.settings.check_cookie_config",
            return_value=response,
        ) as check:
            result = self.post_paths["/api/v1/settings/cookies/check"]()

        check.assert_called_once()
        self.assertEqual(result["validation_status"], "valid")
        self.assertNotIn("content", result)


if __name__ == "__main__":
    unittest.main()
