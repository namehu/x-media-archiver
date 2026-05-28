import asyncio
import json
import unittest
from pathlib import Path

from fastapi import HTTPException
from starlette.exceptions import HTTPException as StarletteHTTPException

from xarchiver.api import schemas
from xarchiver.api.app import create_app
from xarchiver.api.deps import (
    execute_write_action,
    parse_event_topics,
    raise_api_error,
    require_full_scan_confirmation,
    resolve_archive_file,
    write_action_lock,
)
from xarchiver.api.schemas import ArchiveSubmitRequest, SourceCreateRequest, VerifyRequest
from xarchiver.core.errors import ArchiverError
from xarchiver.core.events import EventBroker, format_sse_event


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

    def test_api_error_mapping_is_centralized(self) -> None:
        with self.assertRaises(HTTPException) as missing:
            raise_api_error(ValueError("source_not_found"))
        with self.assertRaises(HTTPException) as conflict:
            raise_api_error(ValueError("source_has_no_unsubmitted_tweets"))

        self.assertEqual(missing.exception.status_code, 404)
        self.assertEqual(conflict.exception.status_code, 409)

    def test_app_registers_error_handlers_and_health(self) -> None:
        app = create_app()
        get_paths = {route.path for route in app.routes if "GET" in getattr(route, "methods", set())}

        self.assertIn(ArchiverError, app.exception_handlers)
        self.assertIn("/health", get_paths)

    def test_legacy_api_routes_are_removed(self) -> None:
        paths = {route.path for route in create_app().routes}

        self.assertNotIn("/api/summary", paths)
        self.assertNotIn("/api/archive-runs", paths)
        self.assertNotIn("/api/sources", paths)
        self.assertIn("/api/v1/library/summary", paths)
        self.assertIn("/api/v1/archive-runs", paths)
        self.assertIn("/api/v1/sources", paths)

    def test_request_schemas_are_split_without_renaming_openapi_components(self) -> None:
        self.assertIs(schemas.VerifyRequest, VerifyRequest)
        self.assertIs(schemas.ArchiveSubmitRequest, ArchiveSubmitRequest)

        component_names = set(create_app().openapi()["components"]["schemas"])

        self.assertIn("VerifyRequest", component_names)
        self.assertIn("ArchiveSubmitRequest", component_names)
        self.assertIn("SourceCreateRequest", component_names)
        self.assertIn("PageResponse", component_names)
        self.assertIn("WriteActionResponse", component_names)
        self.assertIn("DownloadPolicyResponse", component_names)
        self.assertIn("HealthDetailResponse", component_names)

    def test_http_errors_include_standard_fields_and_legacy_detail(self) -> None:
        app = create_app()
        handler = app.exception_handlers[StarletteHTTPException]

        response = asyncio.run(handler(None, HTTPException(status_code=404, detail="source_not_found")))

        self.assertEqual(response.status_code, 404)
        self.assertEqual(
            json.loads(response.body),
            {
                "detail": "source_not_found",
                "code": "source_not_found",
                "message": "source_not_found",
                "category": None,
            },
        )

    def test_archiver_errors_include_category_when_available(self) -> None:
        app = create_app()
        handler = app.exception_handlers[ArchiverError]

        response = asyncio.run(
            handler(None, ArchiverError("rate_limited", category="rate_limited", http_status=429))
        )

        self.assertEqual(response.status_code, 429)
        body = json.loads(response.body)
        self.assertEqual(body["detail"], "rate_limited")
        self.assertEqual(body["code"], "rate_limited")
        self.assertEqual(body["category"], "rate_limited")

    def test_event_topic_parsing_and_sse_format(self) -> None:
        self.assertEqual(parse_event_topics("archive_runs, source_scans ,, "), ["archive_runs", "source_scans"])
        broker = EventBroker()
        subscription = broker.subscribe(["source_scans"])
        try:
            broker.publish("archive_runs", "archive.run.submitted", {"run_id": 1})
            event = broker.publish("source_scans", "source.scan.completed", {"scan_run_id": 2})

            self.assertEqual(subscription.get(timeout=0.1), event)
        finally:
            subscription.close()

        payload = format_sse_event(event)

        self.assertIn("event: source.scan.completed", payload)
        self.assertIn('"scan_run_id":2', payload)


if __name__ == "__main__":
    unittest.main()
