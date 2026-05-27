import unittest
from pathlib import Path

from fastapi import HTTPException

from xarchiver.api.app import (
    BackfillRequest,
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


if __name__ == "__main__":
    unittest.main()
