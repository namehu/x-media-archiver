import copy
import importlib
import unittest
from unittest.mock import patch

from psycopg.types.json import Jsonb
from sqlalchemy import delete, insert, select, update

from xarchiver.db import connect
from xarchiver.importer import upsert_tweets
from xarchiver.services.source_bulk_tasks import (
    create_source_bulk_task,
    create_source_schedule_policy,
    fetch_policy_source_ids,
    get_source_schedule_policy,
    resolve_source_ids,
)
from xarchiver.services.source_media_splits import split_media_sources
from xarchiver.services.source_types import filter_source_media_records, media_source_url
from xarchiver.services.sources import (
    build_gallery_dl_scan_url,
    create_source,
    get_source,
    list_sources_page,
    normalize_gallery_media_type,
    record_source_discoveries,
    scan_source,
    start_source_scan_session,
    stop_source_scan_session,
    submit_source_downloads,
    update_source_status,
)
from xarchiver.sql_builder import compile_query
from xarchiver.tables import (
    archive_runs,
    archive_sources,
    source_discovered_tweets,
    source_media_splits,
    source_scan_runs,
    source_schedule_policies,
    source_schedule_policy_sources,
    tweets,
)


def record(tweet_id: str, types: list[str]) -> dict:
    return {
        "tweet_id": tweet_id,
        "url": f"https://x.com/splitfixture/status/{tweet_id}",
        "author_username": "splitfixture",
        "author_display_name": "Split fixture",
        "text": "fixture",
        "published_at": None,
        "collected_at": None,
        "raw_import": {},
        "source_type": "manual",
        "source_url": None,
        "media_types": types,
        "media_count": len(types),
        "media_items": [
            {"type": kind, "url": f"https://example.test/{tweet_id}/{kind}"} for kind in types
        ],
    }


class MediaSourceTypeTests(unittest.TestCase):
    def test_type_selects_distinct_urls(self):
        for url in [
            "https://x.com/splitfixture",
            "https://x.com/splitfixture/media",
            "https://x.com/splitfixture/media?filter=photo",
        ]:
            self.assertEqual(
                media_source_url("user_photos", url),
                "https://x.com/splitfixture/media?filter=photo",
            )
            self.assertEqual(
                media_source_url("user_videos", url), "https://x.com/splitfixture/media"
            )
            self.assertEqual(
                build_gallery_dl_scan_url("user_photos", url),
                "https://x.com/splitfixture/media?filter=photo",
            )
        self.assertEqual(
            media_source_url("search", "https://x.com/search?q=cat"), "https://x.com/search?q=cat"
        )

    def test_invalid_media_paths_are_rejected(self):
        for url in [
            "https://x.com/i/bookmarks",
            "https://x.com/search",
            "https://x.com/",
            "https://x.com/user/status/123",
        ]:
            with self.subTest(url=url), self.assertRaisesRegex(ValueError, "invalid_source_url"):
                media_source_url("user_photos", url)

    def test_filter_preserves_mixed_tweet_and_does_not_mutate(self):
        rows = [
            record("1", ["photo"]),
            record("2", ["video"]),
            record("3", ["photo", "video"]),
            record("4", []),
        ]
        before = copy.deepcopy(rows)
        self.assertEqual(
            [row["tweet_id"] for row in filter_source_media_records("user_photos", rows)],
            ["1", "3"],
        )
        videos = filter_source_media_records("user_videos", rows)
        self.assertEqual([row["tweet_id"] for row in videos], ["2", "3"])
        self.assertEqual(videos[1]["media_count"], 2)
        self.assertEqual(rows, before)
        self.assertEqual(normalize_gallery_media_type("animated_gif"), "video")

    def test_legacy_creation_rejected_before_database_access(self):
        with patch("xarchiver.services.sources.connect") as db:
            with self.assertRaisesRegex(ValueError, "legacy_media_source_read_only"):
                create_source("user_media", "https://x.com/splitfixture/media")
        db.assert_not_called()

    def test_split_requires_explicit_selection(self):
        for kwargs in ({}, {"source_ids": [1], "all_sources": True}, {"source_ids": [-1]}):
            with self.assertRaisesRegex(ValueError, "specify_source_ids_or_all"):
                split_media_sources(**kwargs)


class MediaSourceSplitIntegrationTests(unittest.TestCase):
    ids = ["929900000000000001", "929900000000000002", "929900000000000003"]

    def setUp(self):
        self.source_ids = []
        self.policy_ids = []
        self.addCleanup(self.cleanup)

    def execute(self, statement):
        with connect() as conn:
            with conn.cursor() as cur:
                cur.execute(*compile_query(statement))
                rows = cur.fetchall() if cur.description else []
            conn.commit()
        return rows

    def cleanup(self):
        self.execute(
            delete(source_schedule_policies).where(
                source_schedule_policies.c.id.in_(self.policy_ids)
            )
        )
        self.execute(
            delete(source_media_splits).where(
                source_media_splits.c.old_source_id.in_(self.source_ids)
            )
        )
        self.execute(delete(archive_runs).where(archive_runs.c.source_id.in_(self.source_ids)))
        self.execute(delete(archive_sources).where(archive_sources.c.id.in_(self.source_ids)))
        self.execute(delete(tweets).where(tweets.c.tweet_id.in_(self.ids)))

    def legacy(self, source_url="https://x.com/splitfixture/media"):
        source_id = self.execute(
            insert(archive_sources)
            .values(
                source_type="user_media",
                source_url=source_url,
                label="fixture",
                cursor_state=Jsonb({"extractor_cursor": "old-native", "automation_enabled": False}),
            )
            .returning(archive_sources.c.id)
        )[0]["id"]
        self.source_ids.append(source_id)
        return source_id

    def current(self, kind):
        source = create_source(kind, "https://x.com/splitfixture/media")
        self.source_ids.append(source["id"])
        return source

    def split(self, source_id):
        return self.split_batch([source_id])["sources"][0]

    def split_batch(self, source_ids=None, *, all_sources=False):
        result = split_media_sources(source_ids, all_sources=all_sources, apply=True)
        for row in result["sources"]:
            if row["status"] == "split":
                self.source_ids.extend(
                    [row["mapping"]["photos_source_id"], row["mapping"]["videos_source_id"]]
                )
        return result

    def test_preview_is_read_only_and_apply_preserves_history_and_is_idempotent(self):
        old_id = self.legacy()
        upsert_tweets([record(self.ids[0], ["photo"])])
        self.execute(
            insert(source_discovered_tweets).values(
                source_id=old_id, tweet_id=self.ids[0], raw_payload=Jsonb({})
            )
        )
        before = get_source(old_id)
        preview = split_media_sources([old_id])
        self.assertTrue(preview["dry_run"])
        self.assertEqual(preview["sources"][0]["status"], "ready")
        self.assertEqual(get_source(old_id), before)
        result = self.split(old_id)
        self.assertEqual(result["status"], "split")
        self.assertIsNone(get_source(old_id))
        old = get_source(old_id, include_deleted=True)
        self.assertEqual(old["cursor_state"]["extractor_cursor"], "old-native")
        self.assertEqual(old["discovered_tweet_count"], 1)
        for key in ("photos_source_id", "videos_source_id"):
            new = get_source(result["mapping"][key])
            self.assertEqual(new["status"], "paused")
            self.assertEqual(new["cursor_state"], {})
            self.assertEqual(new["discovered_tweet_count"], 0)
            self.assertIsNone(new["next_scan_at"])
        self.assertEqual(
            split_media_sources([old_id], apply=True)["sources"][0]["status"], "already_split"
        )
        with self.assertRaisesRegex(ValueError, "source_already_exists"):
            create_source("user_videos", "https://x.com/splitfixture/media")

    def test_conflict_does_not_soft_delete_or_create_partial_split(self):
        old_id = self.legacy()
        self.current("user_videos")
        self.assertEqual(self.split(old_id)["status"], "blocked")
        self.assertIsNotNone(get_source(old_id))
        self.assertEqual(
            self.execute(
                select(source_media_splits).where(source_media_splits.c.old_source_id == old_id)
            ),
            [],
        )

    def test_batch_alias_conflicts_block_every_peer_before_writing_in_any_order(self):
        old_ids = [
            self.legacy(url)
            for url in (
                "https://x.com/splitfixture",
                "https://x.com/splitfixture/media",
                "https://x.com/splitfixture/media?filter=photo",
            )
        ]
        before = [get_source(source_id) for source_id in old_ids]
        preview = split_media_sources(old_ids)
        self.assertTrue(preview["dry_run"])
        self.assertEqual(preview["blocked_count"], 3)
        expected_conflicts = [
            {"source_url": url, "old_source_ids": sorted(old_ids)}
            for url in (
                "https://x.com/splitfixture/media?filter=photo",
                "https://x.com/splitfixture/media",
            )
        ]
        for row in preview["sources"]:
            self.assertEqual(row["status"], "blocked")
            self.assertEqual(row["batch_conflicts"], expected_conflicts)
            self.assertEqual(row["conflicts"], [])
        for selected in (old_ids, list(reversed(old_ids))):
            applied = self.split_batch(selected)
            self.assertEqual(applied["blocked_count"], 3)
            self.assertEqual(
                sorted(applied["sources"], key=lambda row: row["old_source_id"]),
                sorted(preview["sources"], key=lambda row: row["old_source_id"]),
            )
        self.assertEqual([get_source(source_id) for source_id in old_ids], before)
        self.assertEqual(
            self.execute(
                select(source_media_splits).where(source_media_splits.c.old_source_id.in_(old_ids))
            ),
            [],
        )
        self.assertEqual(
            len(
                self.execute(
                    select(archive_sources.c.id).where(
                        archive_sources.c.source_url.like("https://x.com/splitfixture%")
                    )
                )
            ),
            3,
        )

        # An explicit one-source selection resolves the batch ambiguity without
        # merging either legacy source's history; later runs remain idempotent.
        self.assertEqual(self.split(old_ids[0])["status"], "split")
        repeated = self.split_batch(old_ids)
        self.assertEqual(repeated["sources"][0]["status"], "already_split")
        self.assertEqual(repeated["blocked_count"], 2)

    def test_all_selection_blocks_aliases_but_splits_unrelated_source(self):
        independent = self.legacy("https://x.com/otherfixture/media")
        aliases = [self.legacy("https://x.com/splitfixture"), self.legacy()]
        preview = {
            row["old_source_id"]: row for row in split_media_sources(all_sources=True)["sources"]
        }
        self.assertEqual(preview[independent]["status"], "ready")
        self.assertTrue(all(preview[source_id]["status"] == "blocked" for source_id in aliases))
        result = {
            row["old_source_id"]: row for row in self.split_batch(all_sources=True)["sources"]
        }
        self.assertEqual(result[independent]["status"], "split")
        for source_id in aliases:
            self.assertEqual(result[source_id], preview[source_id])
            self.assertIsNotNone(get_source(source_id))

    def test_repeated_input_id_is_not_a_batch_conflict(self):
        old_id = self.legacy()
        preview = split_media_sources([old_id, old_id])
        self.assertEqual(len(preview["sources"]), 1)
        self.assertEqual(preview["sources"][0]["status"], "ready")
        self.assertEqual(preview["sources"][0]["batch_conflicts"], [])
        result = self.split_batch([old_id, old_id])
        self.assertEqual(len(result["sources"]), 1)
        self.assertEqual(result["sources"][0]["status"], "split")

    def test_active_scan_blocks_split(self):
        old_id = self.legacy()
        self.execute(
            insert(source_scan_runs).values(
                source_id=old_id, status="running", trigger_type="manual_next"
            )
        )
        result = self.split(old_id)
        self.assertEqual(result["status"], "blocked")
        self.assertEqual(result["blockers"]["active_scans"], 1)
        self.assertIsNotNone(get_source(old_id))

    def test_enabled_schedule_is_visible_but_not_dispatched_and_blocks_split(self):
        old_id = self.legacy()
        policy = create_source_schedule_policy(
            label="split-fixture",
            action="refresh_latest",
            frequency_kind="interval",
            interval_minutes=360,
            enabled=True,
        )
        self.policy_ids.append(policy["id"])
        self.execute(
            insert(source_schedule_policy_sources).values(policy_id=policy["id"], source_id=old_id)
        )
        self.assertEqual(get_source_schedule_policy(policy["id"])["source_ids"], [old_id])
        self.assertEqual(fetch_policy_source_ids(policy["id"]), [])
        result = self.split(old_id)
        self.assertEqual(result["status"], "blocked")
        self.assertEqual(result["blockers"]["enabled_schedules"], 1)

    def test_paused_download_blocks_split(self):
        old_id = self.legacy()
        self.execute(
            insert(archive_runs).values(
                source_id=old_id, trigger_type="source_download", status="paused"
            )
        )
        result = self.split(old_id)
        self.assertEqual(result["status"], "blocked")
        self.assertEqual(result["blockers"]["active_download_runs"], 1)

    def test_legacy_rejects_new_work_and_filtered_bulk_selection_omits_it(self):
        old_id = self.legacy()
        photos = self.current("user_photos")
        actions = (
            lambda: start_source_scan_session(old_id, "history", limit=5),
            lambda: scan_source(old_id, limit=5),
            lambda: submit_source_downloads(old_id, "unsubmitted"),
            lambda: record_source_discoveries(old_id, [record(self.ids[0], ["photo"])]),
            lambda: create_source_bulk_task("refresh_latest", source_ids=[old_id]),
            lambda: update_source_status(old_id, "active"),
        )
        for action in actions:
            with self.assertRaisesRegex(ValueError, "legacy_media_source_read_only"):
                action()
        self.assertEqual(resolve_source_ids(None, {"search": "splitfixture"}), [photos["id"]])
        page = list_sources_page(search="splitfixture")
        self.assertEqual(page["total_count"], 2)
        self.assertEqual(page["selectable_count"], 1)

    def test_mid_transaction_failure_rolls_back_new_sources(self):
        old_id = self.legacy()
        with patch(
            "xarchiver.services.source_media_splits.set_active_scan_session_state",
            side_effect=RuntimeError("fixture"),
        ):
            with self.assertRaisesRegex(RuntimeError, "fixture"):
                self.split(old_id)
        self.assertIsNotNone(get_source(old_id))
        self.assertEqual(
            self.execute(
                select(archive_sources.c.id).where(
                    archive_sources.c.source_url.like("https://x.com/splitfixture%")
                )
            ),
            [{"id": old_id}],
        )

    def test_filtered_empty_batch_advances_own_cursor_and_sessions_stay_independent(self):
        photos, videos = self.current("user_photos"), self.current("user_videos")
        for source in (photos, videos):
            start_source_scan_session(source["id"], "history", limit=5)
        meta = {"exit_code": 0, "continuation_cursor": "page-2", "cursor_mode": "native"}
        with (
            patch("xarchiver.services.sources.prepare_cookies", return_value=None),
            patch(
                "xarchiver.services.sources.discover_records_with_gallery_dl",
                return_value=([record(self.ids[0], ["video"])], meta),
            ) as discover,
        ):
            result = scan_source(
                photos["id"], limit=5, trigger_type="history_worker", session_mode="history"
            )
        self.assertFalse(result["completed"])
        self.assertEqual(result["discovered_count"], 0)
        self.assertEqual(result["scanner"]["raw_record_count"], 1)
        self.assertEqual(result["scanner"]["matched_record_count"], 0)
        self.assertEqual(
            get_source(photos["id"])["cursor_state"]["scan_sessions"]["history"][
                "extractor_cursor"
            ],
            "page-2",
        )
        self.assertIsNone(
            get_source(videos["id"])["cursor_state"]["scan_sessions"]["history"].get(
                "extractor_cursor"
            )
        )
        discover.assert_called_once()
        # A new latest session must not inherit the source's history cursor.
        stop_source_scan_session(photos["id"])
        start_source_scan_session(photos["id"], "latest_refresh", limit=5)
        with (
            patch("xarchiver.services.sources.prepare_cookies", return_value=None),
            patch(
                "xarchiver.services.sources.discover_records_with_gallery_dl",
                return_value=([], {"exit_code": 0}),
            ) as discover,
        ):
            scan_source(
                photos["id"], limit=5, trigger_type="latest_refresh", session_mode="latest_refresh"
            )
        self.assertIsNone(discover.call_args.kwargs["continuation_cursor"])
        self.assertEqual(
            get_source(photos["id"])["cursor_state"]["scan_sessions"]["history"][
                "extractor_cursor"
            ],
            "page-2",
        )

        start_source_scan_session(photos["id"], "from_start", limit=5)
        with (
            patch("xarchiver.services.sources.prepare_cookies", return_value=None),
            patch(
                "xarchiver.services.sources.discover_records_with_gallery_dl",
                return_value=([], {"exit_code": 0, "continuation_cursor": "repair-page-2"}),
            ) as discover,
        ):
            scan_source(
                photos["id"], limit=5, trigger_type="from_start_repair", session_mode="from_start"
            )
        self.assertIsNone(discover.call_args.kwargs["continuation_cursor"])
        sessions = get_source(photos["id"])["cursor_state"]["scan_sessions"]
        self.assertEqual(sessions["history"]["extractor_cursor"], "page-2")
        self.assertEqual(sessions["from_start"]["extractor_cursor"], "repair-page-2")
        self.assertTrue(sessions["latest_refresh"]["completed"])

    def test_scan_filters_each_source_and_keeps_complete_mixed_tweet(self):
        rows = [
            record(self.ids[0], ["photo"]),
            record(self.ids[1], ["video"]),
            record(self.ids[2], ["photo", "video"]),
        ]
        for kind, expected in (
            ("user_photos", [self.ids[0], self.ids[2]]),
            ("user_videos", [self.ids[1], self.ids[2]]),
        ):
            source = self.current(kind)
            start_source_scan_session(source["id"], "history", limit=5)
            with (
                patch("xarchiver.services.sources.prepare_cookies", return_value=None),
                patch(
                    "xarchiver.services.sources.discover_records_with_gallery_dl",
                    return_value=(rows, {"exit_code": 0}),
                ),
            ):
                result = scan_source(
                    source["id"], limit=5, trigger_type="history_worker", session_mode="history"
                )
            self.assertTrue(result["completed"])
            self.assertEqual(result["discovered_count"], 2)
            discoveries = self.execute(
                select(source_discovered_tweets)
                .where(source_discovered_tweets.c.source_id == source["id"])
                .order_by(source_discovered_tweets.c.tweet_id)
            )
            self.assertEqual([row["tweet_id"] for row in discoveries], expected)
            self.assertEqual(discoveries[-1]["raw_payload"]["media_types"], ["photo", "video"])
        self.assertEqual(
            self.execute(
                select(archive_runs.c.id).where(archive_runs.c.source_id.in_(self.source_ids))
            ),
            [],
        )

    def test_mixed_tweet_links_one_download_then_skips_verified(self):
        photos, videos = self.current("user_photos"), self.current("user_videos")
        mixed = record(self.ids[0], ["photo", "video"])
        for source in (photos, videos):
            record_source_discoveries(source["id"], [mixed])
        first = submit_source_downloads(photos["id"], "selected", tweet_ids=[self.ids[0]])
        second = submit_source_downloads(videos["id"], "selected", tweet_ids=[self.ids[0]])
        self.assertEqual(first["submitted_count"], 1)
        self.assertEqual(second["tasks"]["linked_pending_count"], 1)
        self.execute(
            update(tweets)
            .where(tweets.c.tweet_id == self.ids[0])
            .values(download_status="verified")
        )
        third = submit_source_downloads(videos["id"], "selected", tweet_ids=[self.ids[0]])
        self.assertEqual(third["tasks"]["skipped_verified_count"], 1)

    def test_downgrade_refuses_to_erase_split_mapping(self):
        self.split(self.legacy())
        module = importlib.import_module("xarchiver.alembic.versions.027_split_media_sources")
        from sqlalchemy import create_engine

        from xarchiver.config import get_settings
        from xarchiver.migrations import sqlalchemy_url

        engine = create_engine(sqlalchemy_url(get_settings().database_url))
        try:
            with engine.connect() as conn, patch.object(module.op, "get_bind", return_value=conn):
                with self.assertRaisesRegex(RuntimeError, "media_source_splits_exist"):
                    module.downgrade()
        finally:
            engine.dispose()
