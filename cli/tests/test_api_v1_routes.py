import unittest
from unittest.mock import patch

from fastapi import HTTPException

from xarchiver.api.app import create_app
from xarchiver.api.schemas import BackfillRequest, SourceCreateRequest, SourceStatusRequest, VerifyRequest


class V1RouterSmokeTests(unittest.TestCase):
    """Verify that canonical /api/v1/* routes are registered and wired correctly."""

    def setUp(self):
        self.app = create_app()
        self.get_paths = {
            route.path: route.endpoint
            for route in self.app.routes
            if "GET" in getattr(route, "methods", set())
        }
        self.post_paths = {
            route.path: route.endpoint
            for route in self.app.routes
            if "POST" in getattr(route, "methods", set())
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
            "/api/v1/events",
            "/api/v1/settings/download-policy",
            "/api/v1/media-file/{relative_path:path}",
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
            "/api/v1/sources/{source_id}/scan",
            "/api/v1/sources/{source_id}/history-scan",
            "/api/v1/sources/{source_id}/history-scan/stop",
            "/api/v1/actions/verify",
            "/api/v1/actions/requeue",
            "/api/v1/actions/recover-interrupted",
            "/api/v1/actions/export",
            "/api/v1/maintenance/backfill",
            "/api/v1/maintenance/verify",
        ]
        for path in expected:
            self.assertIn(path, self.post_paths, f"POST {path} not registered")

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

    def test_v1_sources_list_delegates_all_filters(self):
        page = {"rows": [], "count": 0, "total_count": 0, "limit": 5, "offset": 0}
        with patch("xarchiver.api.v1.sources.list_sources_page", return_value=page) as mock:
            result = self.get_paths["/api/v1/sources"](
                limit=5, offset=0, source_status="active", source_type="profile"
            )
        self.assertEqual(result, page)
        mock.assert_called_once_with(status="active", source_type="profile", limit=5, offset=0)

    # ── OpenAPI schema: v1 routes appear in the spec ──────────────────────────

    def test_v1_routes_appear_in_openapi_spec(self):
        paths = set(self.app.openapi()["paths"].keys())
        self.assertIn("/api/v1/archive-runs", paths)
        self.assertIn("/api/v1/sources", paths)
        self.assertIn("/api/v1/library/media", paths)
        self.assertIn("/api/v1/actions/verify", paths)


if __name__ == "__main__":
    unittest.main()
