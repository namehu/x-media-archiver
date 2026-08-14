import asyncio
import json
import os
import unittest
from datetime import UTC, date, datetime
from unittest.mock import ANY, patch
from uuid import uuid4

from api_route_helpers import iter_app_routes
from fastapi import HTTPException

from xarchiver.api.app import create_app
from xarchiver.api.schemas import (
    ArchiveRunsPageResponse,
    ArchiveSourceDetailResponse,
    AuthorOptionsResponse,
    BackfillRequest,
    BulkOrganizationRequest,
    DuplicatesPageResponse,
    FailureIgnoreRequest,
    FailureSelectionRequest,
    GalleryDlCompatibilityResponse,
    LibraryInsightsResponse,
    MediaDeleteRequest,
    OrganizationDeleteRequest,
    PostFeedPageResponse,
    SourceBulkTaskCreateRequest,
    SourceBulkTaskRetryRequest,
    SourceCreateRequest,
    SourceDeleteRequest,
    SourceDiscoveryPageResponse,
    SourcePinRequest,
    SourceReorderRequest,
    SourceScanRunsPageResponse,
    SourcesPageResponse,
    SourceStatusRequest,
    TagWriteRequest,
    TweetHashtagOptionsResponse,
    TweetLabelsRequest,
    TweetNoteRequest,
    TweetOrganizationWriteRequest,
    TweetSearchOptionsResponse,
    TweetSearchPageResponse,
    UpdateCookiesRequest,
    VerifyRequest,
)
from xarchiver.config import get_settings
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
        self.patch_paths = {
            route.path: route.endpoint
            for route in iter_app_routes(self.app)
            if "PATCH" in getattr(route, "methods", set())
        }
        self.put_paths = {
            route.path: route.endpoint
            for route in iter_app_routes(self.app)
            if "PUT" in getattr(route, "methods", set())
        }

    # ── Route registration ─────────────────────────────────────────────────────

    def test_v1_get_routes_registered(self):
        expected = [
            "/api/v1/library/summary",
            "/api/v1/library/insights",
            "/api/v1/library/media",
            "/api/v1/library/authors",
            "/api/v1/library/posts",
            "/api/v1/library/search",
            "/api/v1/library/search/options",
            "/api/v1/library/search/hashtags",
            "/api/v1/library/organization",
            "/api/v1/library/organization/collections/{collection_id}/tweets",
            "/api/v1/library/tweets/{tweet_id}",
            "/api/v1/library/tweets/{tweet_id}/organization",
            "/api/v1/library/failures",
            "/api/v1/library/failures/{tweet_id}/actions",
            "/api/v1/library/duplicates",
            "/api/v1/archive-runs",
            "/api/v1/archive-runs/{run_id}",
            "/api/v1/sources",
            "/api/v1/sources/{source_id}",
            "/api/v1/sources/{source_id}/discovered",
            "/api/v1/sources/{source_id}/scan-runs",
            "/api/v1/source-bulk-tasks",
            "/api/v1/source-bulk-tasks/{task_id}",
            "/api/v1/source-schedule-policies",
            "/api/v1/source-schedule-policies/{policy_id}",
            "/api/v1/events",
            "/api/v1/settings/download-policy",
            "/api/v1/settings/cookies",
            "/api/v1/settings/gallery-dl",
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
            "/api/v1/sources/reorder",
            "/api/v1/sources/{source_id}/scan",
            "/api/v1/sources/{source_id}/history-scan",
            "/api/v1/sources/{source_id}/scan-sessions",
            "/api/v1/sources/{source_id}/scan-sessions/pause",
            "/api/v1/sources/{source_id}/scan-sessions/resume",
            "/api/v1/sources/{source_id}/scan-sessions/stop",
            "/api/v1/sources/{source_id}/history-scan/stop",
            "/api/v1/source-bulk-tasks",
            "/api/v1/source-bulk-tasks/{task_id}/control",
            "/api/v1/source-bulk-tasks/{task_id}/retry",
            "/api/v1/source-schedule-policies",
            "/api/v1/actions/verify",
            "/api/v1/library/failures/ignore",
            "/api/v1/library/failures/restore",
            "/api/v1/library/failures/retry",
            "/api/v1/library/organization/tags",
            "/api/v1/library/organization/collections",
            "/api/v1/library/organization/bulk",
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
        self.assertIn("/api/v1/library/media", self.delete_paths)
        self.assertIn("/api/v1/sources/{source_id}", self.delete_paths)
        self.assertIn("/api/v1/library/organization/tags/{tag_id}", self.delete_paths)
        self.assertIn(
            "/api/v1/library/organization/collections/{collection_id}",
            self.delete_paths,
        )
        self.assertIn("/api/v1/source-schedule-policies/{policy_id}", self.delete_paths)

    def test_v1_source_task_update_routes_registered(self):
        self.assertIn("/api/v1/source-schedule-policies/{policy_id}", self.patch_paths)
        self.assertIn("/api/v1/source-schedule-policies/{policy_id}/sources", self.put_paths)
        self.assertIn("/api/v1/library/organization/tags/{tag_id}", self.put_paths)
        self.assertIn(
            "/api/v1/library/organization/collections/{collection_id}",
            self.put_paths,
        )
        self.assertIn(
            "/api/v1/library/tweets/{tweet_id}/organization",
            self.put_paths,
        )
        self.assertIn(
            "/api/v1/library/tweets/{tweet_id}/organization/labels",
            self.put_paths,
        )
        self.assertIn(
            "/api/v1/library/tweets/{tweet_id}/organization/note",
            self.put_paths,
        )

    def test_v1_organization_routes_delegate_through_write_boundary(self):
        with patch("xarchiver.api.v1.library.execute_write_action") as execute:
            execute.side_effect = lambda name, action, **_kwargs: {
                "action": name,
                "status": "completed",
                "result": action(),
            }
            with (
                patch("xarchiver.api.v1.library.create_tag", return_value={"id": 1}) as create,
                patch("xarchiver.api.v1.library.bulk_update_labels", return_value={"selected_tweet_count": 2}) as bulk,
            ):
                tag_result = self.post_paths["/api/v1/library/organization/tags"](
                    TagWriteRequest(name="物理", color="#3366ff")
                )
                bulk_result = self.post_paths["/api/v1/library/organization/bulk"](
                    BulkOrganizationRequest(tweet_ids=["1", "2"], add_tag_ids=[1])
                )

        self.assertEqual(tag_result["result"]["id"], 1)
        self.assertEqual(bulk_result["result"]["selected_tweet_count"], 2)
        create.assert_called_once_with("物理", "#3366ff", None)
        bulk.assert_called_once_with(
            ["1", "2"],
            add_tag_ids=[1],
            remove_tag_ids=[],
            add_collection_ids=[],
            remove_collection_ids=[],
        )
        self.assertTrue(all(call.kwargs["scope"] == "library-organization" for call in execute.call_args_list))

    def test_v1_library_insights_is_a_read_only_delegation(self):
        response = {
            "overview": {
                "tweet_count": 0,
                "media_count": 0,
                "known_media_bytes": 0,
                "known_video_duration_ms": 0,
                "author_count": 0,
                "source_count": 0,
            },
            "media_types": [],
            "media_statuses": [],
            "published_months": [],
            "imported_months": [],
            "top_authors": [],
            "organization": {
                "total_count": 0,
                "tagged_count": 0,
                "collected_count": 0,
                "noted_count": 0,
                "organized_count": 0,
            },
            "completeness": {
                "tweet_count": 0,
                "published_at_count": 0,
                "author_count": 0,
                "text_count": 0,
                "media_count": 0,
                "media_file_size_count": 0,
                "media_sha256_count": 0,
                "media_dimensions_count": 0,
                "video_count": 0,
                "video_duration_count": 0,
            },
            "discovery": {
                "discovered_count": 0,
                "submitted_count": 0,
                "verified_count": 0,
            },
        }
        with patch("xarchiver.api.v1.library.get_library_insights", return_value=response) as get:
            result = self.get_paths["/api/v1/library/insights"]()

        self.assertEqual(LibraryInsightsResponse.model_validate(result).overview.tweet_count, 0)
        get.assert_called_once_with()

    def test_v1_organization_errors_use_conflict_and_not_found_statuses(self):
        route = self.post_paths["/api/v1/library/organization/tags"]
        with (
            patch(
                "xarchiver.api.v1.library.execute_write_action",
                side_effect=ValueError("tag_name_exists"),
            ),
            self.assertRaises(HTTPException) as duplicate,
        ):
            route(TagWriteRequest(name="重复"))
        self.assertEqual(duplicate.exception.status_code, 409)

        route = self.put_paths["/api/v1/library/tweets/{tweet_id}/organization/labels"]
        with (
            patch(
                "xarchiver.api.v1.library.execute_write_action",
                side_effect=ValueError("tweets_not_found"),
            ),
            self.assertRaises(HTTPException) as missing,
        ):
            route("missing", TweetLabelsRequest())
        self.assertEqual(missing.exception.status_code, 404)

    def test_v1_organization_delete_forwards_confirmation(self):
        with (
            patch("xarchiver.api.v1.library.execute_write_action") as execute,
            patch("xarchiver.api.v1.library.delete_tag", return_value={"id": 8}) as delete,
        ):
            execute.side_effect = lambda name, action, **_kwargs: {
                "action": name,
                "status": "completed",
                "result": action(),
            }
            result = self.delete_paths["/api/v1/library/organization/tags/{tag_id}"](
                8,
                OrganizationDeleteRequest(confirm_delete=True),
            )

        self.assertEqual(result["result"]["id"], 8)
        delete.assert_called_once_with(8, confirmed=True)

    def test_v1_tweet_organization_updates_delegate(self):
        with patch("xarchiver.api.v1.library.execute_write_action") as execute:
            execute.side_effect = lambda name, action, **_kwargs: {
                "action": name,
                "status": "completed",
                "result": action(),
            }
            with (
                patch(
                    "xarchiver.api.v1.library.replace_tweet_organization",
                    return_value={"tweet_id": "1"},
                ) as organization,
                patch("xarchiver.api.v1.library.replace_tweet_labels", return_value={"tweet_id": "1"}) as labels,
                patch("xarchiver.api.v1.library.save_tweet_note", return_value={"tweet_id": "1"}) as note,
            ):
                self.put_paths["/api/v1/library/tweets/{tweet_id}/organization"](
                    "1",
                    TweetOrganizationWriteRequest(
                        tag_ids=[2],
                        collection_ids=[3],
                        note_content="private note",
                    ),
                )
                self.put_paths["/api/v1/library/tweets/{tweet_id}/organization/labels"](
                    "1",
                    TweetLabelsRequest(tag_ids=[2], collection_ids=[3]),
                )
                self.put_paths["/api/v1/library/tweets/{tweet_id}/organization/note"](
                    "1",
                    TweetNoteRequest(content="private note"),
                )

        organization.assert_called_once_with("1", [2], [3], "private note")
        labels.assert_called_once_with("1", [2], [3])
        note.assert_called_once_with("1", "private note")

    def test_v1_source_bulk_task_creation_delegates_frozen_selection(self):
        result = {"id": 41, "status": "queued"}
        request = SourceBulkTaskCreateRequest(task_type="refresh_latest", source_ids=[2, 3])
        with patch(
            "xarchiver.api.v1.source_tasks.create_source_bulk_task",
            return_value=result,
        ) as create:
            response = self.post_paths["/api/v1/source-bulk-tasks"](request)

        self.assertEqual(response, result)
        create.assert_called_once_with(
            "refresh_latest",
            source_ids=[2, 3],
            source_filter=None,
            options={"confirm_large_download": False},
        )

    def test_v1_source_bulk_task_rejects_internal_options(self):
        with self.assertRaises(ValueError):
            SourceBulkTaskCreateRequest(
                task_type="download_missing",
                source_ids=[2, 3],
                options={"wave_size": 50, "manual_confirm_threshold": 999999},
            )

    def test_v1_source_bulk_task_rejects_unknown_filter_fields(self):
        with self.assertRaises(ValueError):
            SourceBulkTaskCreateRequest(
                task_type="refresh_latest",
                source_filter={"source_type": "user_media", "wave_size": 50},
            )

    def test_v1_source_bulk_task_retry_forwards_confirmation(self):
        result = {"id": 42, "status": "queued"}
        request = SourceBulkTaskRetryRequest(confirm_large_download=True)
        with patch(
            "xarchiver.api.v1.source_tasks.retry_source_bulk_task",
            return_value=result,
        ) as retry:
            response = self.post_paths["/api/v1/source-bulk-tasks/{task_id}/retry"](41, request)

        self.assertEqual(response, result)
        retry.assert_called_once_with(41, confirm_large_download=True)

    def test_v1_media_delete_rejects_unconfirmed(self):
        with self.assertRaises(HTTPException) as ctx:
            self.delete_paths["/api/v1/library/media"](
                MediaDeleteRequest(operation_id=uuid4(), media_ids=[1])
            )
        self.assertEqual(ctx.exception.status_code, 400)
        self.assertEqual(ctx.exception.detail, "physical_delete_confirmation_required")

    def test_v1_library_authors_delegates_remote_search(self):
        response = {
            "rows": [
                {
                    "author_username": "alice",
                    "author_display_name": "Alice",
                    "media_count": 3,
                }
            ],
            "count": 1,
        }
        with patch("xarchiver.api.v1.library.get_author_options", return_value=response) as mock:
            result = self.get_paths["/api/v1/library/authors"](q="@ali", limit=10)

        payload = AuthorOptionsResponse.model_validate(result).model_dump(mode="json")
        self.assertEqual(payload["rows"][0]["author_username"], "alice")
        mock.assert_called_once_with(query="@ali", limit=10)

    def test_v1_library_failures_delegates_server_filters(self):
        page = {
            "rows": [],
            "count": 0,
            "total_count": 0,
            "limit": 50,
            "offset": 0,
            "aggregates": {},
            "disposition_counts": {},
            "error_categories": [],
        }
        with patch("xarchiver.api.v1.library.list_failures", return_value=page) as list_page:
            result = self.get_paths["/api/v1/library/failures"](
                disposition="ignored",
                status=["corrupt"],
                error_category="sha256_mismatch",
                search="alice",
                sort="oldest",
                limit=50,
                offset=0,
            )

        self.assertEqual(result, page)
        list_page.assert_called_once_with(
            limit=50,
            offset=0,
            disposition="ignored",
            statuses=["corrupt"],
            error_category="sha256_mismatch",
            search="alice",
            sort="oldest",
        )

    def test_v1_failure_actions_use_serialized_write_entrypoints(self):
        expected = {"requested_count": 1, "succeeded_count": 1, "skipped_count": 0, "skip_reasons": {}}
        with (
            patch("xarchiver.api.v1.library.ignore_failures", return_value=expected) as ignore,
            patch("xarchiver.api.v1.library.restore_failures", return_value=expected) as restore,
            patch("xarchiver.api.v1.library.retry_failures", return_value=expected) as retry,
        ):
            ignored = self.post_paths["/api/v1/library/failures/ignore"](
                FailureIgnoreRequest(tweet_ids=["123"], reason="unsupported", note="later")
            )
            restored = self.post_paths["/api/v1/library/failures/restore"](
                FailureSelectionRequest(tweet_ids=["123"])
            )
            retried = self.post_paths["/api/v1/library/failures/retry"](
                FailureSelectionRequest(tweet_ids=["123"])
            )

        self.assertEqual(ignored["action"], "ignore-failures")
        self.assertEqual(restored["action"], "restore-failures")
        self.assertEqual(retried["action"], "retry-failures")
        ignore.assert_called_once_with(["123"], "unsupported", "later")
        restore.assert_called_once_with(["123"])
        retry.assert_called_once_with(["123"])

    def test_v1_library_posts_delegates_grouped_filters(self):
        response = {
            "rows": [
                {
                    "tweet_id": "123",
                    "tweet_url": "https://x.com/alice/status/123",
                    "author_username": "alice",
                    "author_display_name": "Alice",
                    "published_at": datetime(2026, 1, 1, tzinfo=UTC),
                    "tweet_text": "hello",
                    "tweet_status": "verified",
                    "media": [
                        {
                            "id": 9,
                            "tweet_id": "123",
                            "media_index": 1,
                            "media_type": "photo",
                            "media_status": "verified",
                            "media_relative_path": "media/alice/123/photo.jpg",
                            "media_url": "/api/v1/media-file/media/alice/123/photo.jpg",
                        }
                    ],
                }
            ],
            "count": 1,
            "total_count": 1,
            "limit": 20,
            "offset": 0,
        }
        with (
            patch("xarchiver.api.v1.library.get_settings", return_value=object()),
            patch("xarchiver.api.v1.library.list_posts_page", return_value=response) as mock,
        ):
            result = self.get_paths["/api/v1/library/posts"](
                source_id=4,
                source_type=None,
                author_username="alice",
                text="hello",
                media_type="photo",
                limit=20,
                offset=0,
            )

        payload = PostFeedPageResponse.model_validate(result).model_dump(mode="json")
        self.assertEqual(payload["rows"][0]["media"][0]["id"], 9)
        mock.assert_called_once_with(
            ANY,
            source_id=4,
            source_type=None,
            author_username="alice",
            text="hello",
            media_type="photo",
            limit=20,
            offset=0,
        )

    def test_v1_library_search_delegates_filters_and_validates_response(self):
        response = {
            "rows": [
                {
                    "tweet_id": "123",
                    "tweet_url": "https://x.com/alice/status/123",
                    "author_username": "alice",
                    "published_at": datetime(2026, 1, 1, tzinfo=UTC),
                    "tweet_text": "quantum chaos",
                    "tweet_status": "verified",
                    "relevance": 1.5,
                    "hashtags": ["Quantum"],
                    "tags": ["物理"],
                    "collections": ["研究"],
                    "note_excerpt": "稍后复习",
                    "media": [],
                }
            ],
            "count": 1,
            "total_count": 1,
            "limit": 20,
            "offset": 0,
        }
        with (
            patch("xarchiver.api.v1.library.get_settings", return_value=object()),
            patch(
                "xarchiver.api.v1.library.search_tweets_page",
                return_value=response,
            ) as mock,
        ):
            result = self.get_paths["/api/v1/library/search"](
                q="quantum",
                source_id=4,
                date_from=date(2026, 1, 1),
                date_to=date(2026, 1, 31),
                media_type="video",
                tweet_status="verified",
                tag_id=6,
                collection_id=8,
                hashtag="Quantum",
                sort="relevance",
                client_utc_offset_minutes=-480,
                limit=20,
                offset=0,
            )

        payload = TweetSearchPageResponse.model_validate(result).model_dump(mode="json")
        self.assertEqual(payload["rows"][0]["tags"], ["物理"])
        mock.assert_called_once_with(
            ANY,
            query="quantum",
            source_id=4,
            date_from=date(2026, 1, 1),
            date_to=date(2026, 1, 31),
            media_type="video",
            tweet_status="verified",
            tag_id=6,
            collection_id=8,
            hashtag="Quantum",
            sort="relevance",
            client_utc_offset_minutes=-480,
            limit=20,
            offset=0,
        )

    def test_v1_library_search_rejects_reversed_date_range(self):
        with self.assertRaises(HTTPException) as error:
            self.get_paths["/api/v1/library/search"](
                q=None,
                source_id=None,
                date_from=date(2026, 2, 1),
                date_to=date(2026, 1, 1),
                media_type=None,
                tweet_status="verified",
                tag_id=None,
                collection_id=None,
                hashtag=None,
                sort="auto",
                client_utc_offset_minutes=0,
                limit=20,
                offset=0,
            )

        self.assertEqual(error.exception.status_code, 400)
        self.assertEqual(error.exception.detail, "invalid_search_date_range")

    def test_v1_library_search_options_validate_response(self):
        response = {
            "tags": [{"id": 1, "name": "物理", "color": None, "tweet_count": 2}],
            "collections": [{"id": 2, "name": "研究", "tweet_count": 3}],
        }
        with patch(
            "xarchiver.api.v1.library.get_tweet_search_options",
            return_value=response,
        ):
            result = self.get_paths["/api/v1/library/search/options"]()

        payload = TweetSearchOptionsResponse.model_validate(result).model_dump(mode="json")
        self.assertEqual(payload["collections"][0]["tweet_count"], 3)

    def test_v1_library_hashtag_options_are_bounded_and_validate_response(self):
        response = {
            "rows": [{"name": "Quantum", "normalized_name": "quantum", "tweet_count": 3}],
            "count": 1,
        }
        with patch(
            "xarchiver.api.v1.library.get_tweet_hashtag_options",
            return_value=response,
        ) as options:
            result = self.get_paths["/api/v1/library/search/hashtags"](q="qua", limit=10)

        payload = TweetHashtagOptionsResponse.model_validate(result).model_dump(mode="json")
        self.assertEqual(payload["rows"][0]["normalized_name"], "quantum")
        options.assert_called_once_with(query="qua", limit=10)

    def test_v1_gallery_dl_status_is_read_only_and_validates_response(self):
        response = {
            "installed_version": "1.32.1",
            "tested_versions": ["1.32.1"],
            "validation_status": "tested",
            "warning_code": None,
        }
        with patch("xarchiver.api.v1.settings.gallery_dl_compatibility", return_value=response):
            result = self.get_paths["/api/v1/settings/gallery-dl"]()

        payload = GalleryDlCompatibilityResponse.model_validate(result).model_dump(mode="json")
        self.assertEqual(payload["validation_status"], "tested")

    def test_v1_duplicates_response_uses_complete_groups_with_media_ids(self):
        page = {
            "groups": [
                {
                    "sha256": "same-hash",
                    "duplicate_count": 2,
                    "total_size": 200,
                    "rows": [
                        {
                            "id": 41,
                            "tweet_id": "123",
                            "tweet_url": "https://x.com/test/status/123",
                            "media_index": 1,
                            "media_status": "verified",
                            "media_relative_path": "media/test/123/image.jpg",
                        }
                    ],
                }
            ],
            "count": 1,
            "total_count": 3,
            "limit": 20,
            "offset": 0,
            "duplicate_groups": 3,
            "total_media_count": 7,
        }
        with patch("xarchiver.api.v1.library.list_duplicates_page", return_value=page) as list_page:
            result = self.get_paths["/api/v1/library/duplicates"](limit=20, offset=0)

        payload = DuplicatesPageResponse.model_validate(result).model_dump(mode="json")
        self.assertEqual(payload["groups"][0]["rows"][0]["id"], 41)
        self.assertEqual(payload["groups"][0]["rows"][0]["media_index"], 1)
        self.assertEqual(payload["total_count"], 3)
        self.assertEqual(payload["total_media_count"], 7)
        list_page.assert_called_once_with(ANY, limit=20, offset=0)

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

    def test_v1_source_create_maps_duplicate_to_409(self):
        with patch("xarchiver.api.v1.sources.create_source", side_effect=ValueError("source_already_exists")):
            with self.assertRaises(HTTPException) as ctx:
                self.post_paths["/api/v1/sources"](
                    SourceCreateRequest(source_type="profile", source_url="https://x.com/user")
                )
        self.assertEqual(ctx.exception.status_code, 409)
        self.assertEqual(ctx.exception.detail, "source_already_exists")

    def test_v1_source_status_maps_not_found_to_404(self):
        with patch("xarchiver.api.v1.sources.update_source_status", side_effect=ValueError("source_not_found")):
            with self.assertRaises(HTTPException) as ctx:
                self.post_paths["/api/v1/sources/{source_id}/status"](
                    999, SourceStatusRequest(status="paused")
                )
        self.assertEqual(ctx.exception.status_code, 404)

    def test_v1_source_delete_requires_confirmation(self):
        with self.assertRaises(HTTPException) as ctx:
            self.delete_paths["/api/v1/sources/{source_id}"](
                2, SourceDeleteRequest()
            )
        self.assertEqual(ctx.exception.status_code, 400)
        self.assertEqual(ctx.exception.detail, "source_delete_confirmation_required")

    def test_v1_source_delete_maps_active_work_to_409(self):
        with patch("xarchiver.api.v1.sources.delete_source", side_effect=ValueError("source_delete_active_work")):
            with self.assertRaises(HTTPException) as ctx:
                self.delete_paths["/api/v1/sources/{source_id}"](
                    2, SourceDeleteRequest(confirm_delete=True)
                )
        self.assertEqual(ctx.exception.status_code, 409)
        self.assertEqual(ctx.exception.detail, "source_delete_active_work")

    def test_v1_source_delete_http_requires_body(self):
        response = self._api_delete("/api/v1/sources/2")

        self.assertEqual(response["status"], 422)

    def test_v1_source_delete_http_rejects_unconfirmed_body(self):
        response = self._api_delete("/api/v1/sources/2", body={"confirm_delete": False})

        self.assertEqual(response["status"], 400)
        self.assertEqual(response["json"]["detail"], "source_delete_confirmation_required")

    def test_v1_source_delete_http_maps_active_work_to_409(self):
        with patch("xarchiver.api.v1.sources.delete_source", side_effect=ValueError("source_delete_active_work")):
            response = self._api_delete("/api/v1/sources/2", body={"confirm_delete": True})

        self.assertEqual(response["status"], 409)
        self.assertEqual(response["json"]["detail"], "source_delete_active_work")

    def _api_delete(self, path: str, body: dict[str, object] | None = None) -> dict[str, object]:
        with patch.dict(os.environ, {"AUTH_MODE": "disabled"}):
            get_settings.cache_clear()
            try:
                app = create_app()
                return asyncio.run(asgi_request(app, "DELETE", path, body))
            finally:
                get_settings.cache_clear()

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
                deleted="all",
                sort_by="created_at",
                sort_direction="asc",
            )
        self.assertEqual(result, page)
        mock.assert_called_once_with(
            status="active",
            source_type="profile",
            deleted="all",
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

    def test_v1_source_reorder_uses_write_action(self):
        with patch(
            "xarchiver.api.v1.sources.reorder_sources",
            return_value={"source_ids": [3, 2], "is_pinned": False, "updated_count": 2},
        ) as mock:
            result = self.post_paths["/api/v1/sources/reorder"](SourceReorderRequest(source_ids=[3, 2]))

        self.assertEqual(result["action"], "source-reorder")
        self.assertEqual(result["status"], "completed")
        self.assertEqual(result["result"]["source_ids"], [3, 2])
        mock.assert_called_once_with([3, 2])

    def test_v1_source_reorder_maps_invalid_sources_to_409(self):
        with patch("xarchiver.api.v1.sources.reorder_sources", side_effect=ValueError("source_reorder_invalid_source")):
            with self.assertRaises(HTTPException) as ctx:
                self.post_paths["/api/v1/sources/reorder"](SourceReorderRequest(source_ids=[3, 2]))
        self.assertEqual(ctx.exception.status_code, 409)

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

        with patch("xarchiver.api.v1.sources.get_source", return_value=detail) as mock:
            result = self.get_paths["/api/v1/sources/{source_id}"](2, include_deleted=True)

        mock.assert_called_once_with(2, include_deleted=True)

        payload = ArchiveSourceDetailResponse.model_validate(result).model_dump(mode="json")
        self.assertEqual(payload["scan_summary"]["batch_count"], 5)
        self.assertIn("active_scan_run", payload)
        self.assertNotIn("discovered", payload)
        self.assertNotIn("scan_runs", payload)

    def test_v1_source_discovered_delegates_pagination(self):
        page = {"rows": [], "count": 0, "total_count": 7, "unfiltered_total_count": 9, "facets": None, "limit": 25, "offset": 50}
        with patch("xarchiver.api.v1.sources.list_source_discovered_page", return_value=page) as mock:
            result = self.get_paths["/api/v1/sources/{source_id}/discovered"](
                2,
                limit=25,
                offset=50,
                include_deleted=True,
                media_type="video",
                queue_state="unsubmitted",
                download_state="pending",
            )

        payload = SourceDiscoveryPageResponse.model_validate(result).model_dump(mode="json")
        self.assertEqual(payload["total_count"], 7)
        self.assertEqual(payload["unfiltered_total_count"], 9)
        mock.assert_called_once_with(
            2,
            limit=25,
            offset=50,
            include_deleted=True,
            media_type="video",
            queue_state="unsubmitted",
            download_state="pending",
        )

    def test_v1_source_downloads_delegates_include_deleted(self):
        response = {"source_id": 2, "recent_runs": []}
        with patch("xarchiver.api.v1.sources.get_source_downloads", return_value=response) as mock:
            result = self.get_paths["/api/v1/sources/{source_id}/downloads"](2, include_deleted=True)

        self.assertEqual(result, response)
        mock.assert_called_once_with(2, include_deleted=True)

    def test_v1_source_scan_runs_delegates_pagination(self):
        page = {"rows": [], "count": 0, "total_count": 3, "limit": 20, "offset": 20}
        with patch("xarchiver.api.v1.sources.list_source_scan_runs_page", return_value=page) as mock:
            result = self.get_paths["/api/v1/sources/{source_id}/scan-runs"](2, limit=20, offset=20, include_deleted=True)

        payload = SourceScanRunsPageResponse.model_validate(result).model_dump(mode="json")
        self.assertEqual(payload["total_count"], 3)
        mock.assert_called_once_with(2, limit=20, offset=20, include_deleted=True)

    # ── OpenAPI schema: v1 routes appear in the spec ──────────────────────────

    def test_v1_routes_appear_in_openapi_spec(self):
        paths = set(self.app.openapi()["paths"].keys())
        self.assertIn("/api/v1/archive-runs", paths)
        self.assertIn("/api/v1/sources", paths)
        self.assertIn("/api/v1/sources/{source_id}", paths)
        self.assertIn("/api/v1/sources/{source_id}/scan-sessions", paths)
        self.assertIn("/api/v1/library/media", paths)
        self.assertIn("/api/v1/library/authors", paths)
        self.assertIn("/api/v1/library/posts", paths)
        self.assertIn("/api/v1/library/search", paths)
        self.assertIn("/api/v1/library/search/options", paths)
        self.assertIn("/api/v1/library/search/hashtags", paths)
        self.assertIn("/api/v1/library/insights", paths)
        self.assertIn("/api/v1/actions/verify", paths)
        self.assertIn("/api/v1/health/detail", paths)
        self.assertIn("/api/v1/runtime/snapshot", paths)
        self.assertIn("/api/v1/settings/cookies", paths)
        self.assertIn("/api/v1/settings/gallery-dl", paths)
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

async def asgi_request(app, method: str, path: str, body: dict[str, object] | None = None) -> dict[str, object]:
    body_bytes = b"" if body is None else json.dumps(body).encode()
    headers = [(b"host", b"testserver")]
    if body is not None:
        headers.append((b"content-type", b"application/json"))
    scope = {
        "type": "http",
        "asgi": {"version": "3.0", "spec_version": "2.3"},
        "http_version": "1.1",
        "method": method,
        "scheme": "http",
        "path": path,
        "raw_path": path.encode(),
        "query_string": b"",
        "headers": headers,
        "client": ("testclient", 50000),
        "server": ("testserver", 80),
        "root_path": "",
    }
    messages: list[dict[str, object]] = []
    request_sent = False

    async def receive() -> dict[str, object]:
        nonlocal request_sent
        if request_sent:
            return {"type": "http.request", "body": b"", "more_body": False}
        request_sent = True
        return {"type": "http.request", "body": body_bytes, "more_body": False}

    async def send(message: dict[str, object]) -> None:
        messages.append(message)

    await app(scope, receive, send)
    status = next(message["status"] for message in messages if message["type"] == "http.response.start")
    response_body = b"".join(
        message.get("body", b"")
        for message in messages
        if message["type"] == "http.response.body"
    )
    return {"status": status, "body": response_body, "json": json.loads(response_body or b"{}")}


if __name__ == "__main__":
    unittest.main()
