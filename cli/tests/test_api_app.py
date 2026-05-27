import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException

from xarchiver.api.app import (
    ArchiveRecord,
    ArchiveSubmitRequest,
    BackfillRequest,
    SourceCreateRequest,
    SourceStatusRequest,
    VerifyRequest,
    create_app,
    execute_write_action,
    require_full_scan_confirmation,
    resolve_archive_file,
    write_action_lock,
)


class ApiAppTests(unittest.TestCase):
    def test_execute_write_action_wraps_result(self) -> None:
        result = execute_write_action("verify", lambda: {"checked": 1})

        self.assertEqual(
            result,
            {
                "action": "verify",
                "status": "completed",
                "result": {"checked": 1},
            },
        )

    def test_execute_write_action_rejects_concurrent_actions(self) -> None:
        acquired = write_action_lock.acquire(blocking=False)
        self.assertTrue(acquired)
        try:
            with self.assertRaises(HTTPException) as error:
                execute_write_action("verify", lambda: {"checked": 1})
        finally:
            write_action_lock.release()

        self.assertEqual(error.exception.status_code, 409)
        self.assertEqual(error.exception.detail, "write_action_in_progress")

    def test_resolve_archive_file_rejects_path_escape(self) -> None:
        with self.assertRaises(HTTPException) as error:
            resolve_archive_file(Path("/tmp/archive"), "../secrets/cookies.txt")

        self.assertEqual(error.exception.status_code, 400)

    def test_full_scan_requires_confirmation(self) -> None:
        with self.assertRaises(HTTPException) as error:
            require_full_scan_confirmation(False)

        self.assertEqual(error.exception.status_code, 400)
        self.assertEqual(error.exception.detail, "full_scan_confirmation_required")

    def test_full_scan_endpoints_reject_unconfirmed_requests(self) -> None:
        endpoints = {
            route.path: route.endpoint
            for route in create_app().routes
            if route.path in {"/api/maintenance/backfill", "/api/maintenance/verify", "/api/actions/verify"}
        }

        for path, request in (
            ("/api/maintenance/backfill", BackfillRequest()),
            ("/api/maintenance/verify", VerifyRequest()),
            ("/api/actions/verify", VerifyRequest()),
        ):
            with self.assertRaises(HTTPException) as error:
                endpoints[path](request)
            self.assertEqual(error.exception.status_code, 400)
            self.assertEqual(error.exception.detail, "full_scan_confirmation_required")

    def test_archive_run_api_rejects_invalid_url_without_file_path_endpoint(self) -> None:
        app = create_app()
        paths = {
            route.path: route.endpoint
            for route in app.routes
            if "POST" in getattr(route, "methods", set())
        }
        self.assertIn("/api/archive-runs", paths)
        self.assertNotIn("/api/inbox", paths)
        self.assertNotIn("/api/runs/archive-urls", paths)

        with self.assertRaises(HTTPException) as error:
            paths["/api/archive-runs"](
                ArchiveSubmitRequest(records=[ArchiveRecord(url="https://x.com/user/likes")])
            )
        self.assertEqual(error.exception.status_code, 400)

    def test_source_routes_are_registered(self) -> None:
        app = create_app()
        post_paths = {
            route.path: route.endpoint
            for route in app.routes
            if "POST" in getattr(route, "methods", set())
        }
        get_paths = {
            route.path: route.endpoint
            for route in app.routes
            if "GET" in getattr(route, "methods", set())
        }

        self.assertIn("/api/sources", post_paths)
        self.assertIn("/api/sources", get_paths)
        self.assertIn("/api/sources/{source_id}", get_paths)
        self.assertIn("/api/sources/{source_id}/records", post_paths)
        self.assertIn("/api/sources/{source_id}/status", post_paths)
        self.assertIn("/api/sources/{source_id}/scan", post_paths)

        with self.assertRaises(HTTPException) as error:
            post_paths["/api/sources"](
                SourceCreateRequest(source_type="profile", source_url="https://example.com/user")
            )
        self.assertEqual(error.exception.status_code, 400)

        with patch("xarchiver.api.app.update_source_status", side_effect=ValueError("source_not_found")):
            with self.assertRaises(HTTPException) as error:
                post_paths["/api/sources/{source_id}/status"](999, SourceStatusRequest(status="paused"))
        self.assertEqual(error.exception.status_code, 404)


if __name__ == "__main__":
    unittest.main()
