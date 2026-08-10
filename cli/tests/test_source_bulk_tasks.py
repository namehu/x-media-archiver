import unittest
from datetime import UTC, datetime, timedelta
from unittest.mock import patch

from xarchiver.db import connect
from xarchiver.services.source_bulk_tasks import (
    advance_source_bulk_tasks,
    circuit_breaker_triggered,
    control_source_bulk_task,
    create_source_bulk_task,
    create_source_schedule_policy,
    get_source_bulk_task,
    get_source_schedule_policy,
    process_due_source_schedules,
    retry_source_bulk_task,
    update_source_schedule_policy,
)
from xarchiver.services.sources import (
    create_source,
    record_source_discoveries,
    start_source_scan_run,
)


class SourceBulkTaskIntegrationTests(unittest.TestCase):
    source_urls = [
        "https://x.com/test-bulk-one/media",
        "https://x.com/test-bulk-two/media",
        "https://x.com/test-bulk-manual/status/939900000000000001",
        "https://x.com/test-bulk-three/media",
        "https://x.com/test-bulk-four/media",
        "https://x.com/test-bulk-five/media",
    ]
    tweet_ids = ["939900000000000001", "939900000000000002"]

    def setUp(self) -> None:
        self.cleanup_db()

    def tearDown(self) -> None:
        self.cleanup_db()

    def cleanup_db(self) -> None:
        with connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    delete from archive_runs
                    where source_id in (
                      select id from archive_sources where source_url = any(%s)
                    )
                    """,
                    (self.source_urls,),
                )
                cur.execute(
                    """
                    delete from source_bulk_tasks
                    where exists (
                      select 1
                      from source_bulk_task_items i
                      join archive_sources s on s.id = i.source_id
                      where i.task_id = source_bulk_tasks.id
                        and s.source_url = any(%s)
                    )
                    """,
                    (self.source_urls,),
                )
                cur.execute("delete from source_schedule_policies where label like 'test-bulk-%'")
                cur.execute("delete from archive_sources where source_url = any(%s)", (self.source_urls,))
                cur.execute("delete from tweets where tweet_id = any(%s)", (self.tweet_ids,))
            conn.commit()

    def record(self, tweet_id: str) -> dict[str, object]:
        return {
            "tweet_id": tweet_id,
            "url": f"https://x.com/test-bulk/status/{tweet_id}",
            "author_username": "test-bulk",
            "author_display_name": None,
            "text": None,
            "published_at": None,
            "collected_at": None,
            "raw_import": {},
        }

    def test_create_task_freezes_sources_and_assigns_waves(self) -> None:
        first = create_source("user_media", self.source_urls[0])
        second = create_source("user_media", self.source_urls[1])

        task = create_source_bulk_task(
            "refresh_latest",
            source_ids=[int(first["id"]), int(second["id"])],
            options={"wave_size": 50},
        )

        self.assertEqual(task["status"], "queued")
        self.assertEqual(task["total_count"], 2)
        self.assertEqual([item["source_id"] for item in task["items"]], [first["id"], second["id"]])
        self.assertEqual([item["wave_index"] for item in task["items"]], [0, 0])

    def test_task_requires_an_explicit_selection_contract(self) -> None:
        with self.assertRaisesRegex(ValueError, "source_bulk_task_sources_required"):
            create_source_bulk_task("refresh_latest")
        with self.assertRaisesRegex(ValueError, "source_bulk_task_sources_required"):
            create_source_bulk_task("refresh_latest", source_ids=[])

    def test_resuming_auth_blocked_task_requeues_its_failed_sources(self) -> None:
        source = create_source("user_media", self.source_urls[0])
        task = create_source_bulk_task("refresh_latest", source_ids=[int(source["id"])])
        item_id = int(task["items"][0]["id"])
        with connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    update source_bulk_task_items
                    set status = 'failed', error_category = 'auth_required', finished_at = now()
                    where id = %s
                    """,
                    (item_id,),
                )
                cur.execute(
                    "update source_bulk_tasks set status = 'blocked' where id = %s",
                    (task["id"],),
                )
            conn.commit()

        resumed = control_source_bulk_task(int(task["id"]), "resume")

        self.assertEqual(resumed["status"], "running")
        self.assertEqual(resumed["items"][0]["status"], "queued")
        self.assertIsNone(resumed["items"][0]["error_category"])

    def test_download_missing_task_creates_per_source_archive_run(self) -> None:
        source = create_source("manual", self.source_urls[2])
        record_source_discoveries(
            int(source["id"]),
            [self.record(self.tweet_ids[0])],
        )
        task = create_source_bulk_task("download_missing", source_ids=[int(source["id"])])

        advance_source_bulk_tasks()

        detail = get_source_bulk_task(int(task["id"]))
        self.assertIsNotNone(detail)
        item = detail["items"][0]
        self.assertEqual(item["status"], "downloading")
        self.assertEqual(item["submitted_count"], 1)
        self.assertIsNotNone(item["archive_run_id"])

        paused = control_source_bulk_task(int(task["id"]), "pause")
        with connect() as conn:
            with conn.cursor() as cur:
                cur.execute("select status from archive_runs where id = %s", (item["archive_run_id"],))
                paused_run_status = cur.fetchone()["status"]
        self.assertEqual(paused["status"], "paused")
        self.assertEqual(paused_run_status, "paused")

        resumed = control_source_bulk_task(int(task["id"]), "resume")
        with connect() as conn:
            with conn.cursor() as cur:
                cur.execute("select status from archive_runs where id = %s", (item["archive_run_id"],))
                resumed_run_status = cur.fetchone()["status"]
        self.assertEqual(resumed["status"], "running")
        self.assertEqual(resumed_run_status, "queued")

    def test_large_manual_download_requires_explicit_confirmation(self) -> None:
        source = create_source("manual", self.source_urls[2])

        with (
            patch("xarchiver.services.source_bulk_tasks.count_missing_downloads", return_value=501),
            self.assertRaisesRegex(
                ValueError,
                "source_bulk_task_large_download_confirmation_required",
            ),
        ):
            create_source_bulk_task(
                "download_missing",
                source_ids=[int(source["id"])],
                options={"manual_confirm_threshold": 999999},
            )

    def test_retry_manual_download_rechecks_large_download_confirmation(self) -> None:
        source = create_source("manual", self.source_urls[2])
        task = create_source_bulk_task("download_missing", source_ids=[int(source["id"])])
        item_id = int(task["items"][0]["id"])
        with connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "update source_bulk_task_items set status = 'failed', finished_at = now() where id = %s",
                    (item_id,),
                )
                cur.execute(
                    "update source_bulk_tasks set status = 'completed_with_issues', finished_at = now() where id = %s",
                    (task["id"],),
                )
            conn.commit()

        with (
            patch("xarchiver.services.source_bulk_tasks.count_missing_downloads", return_value=501),
            self.assertRaisesRegex(ValueError, "source_bulk_task_large_download_confirmation_required"),
        ):
            retry_source_bulk_task(int(task["id"]))

        with patch("xarchiver.services.source_bulk_tasks.count_missing_downloads", return_value=501):
            retried = retry_source_bulk_task(int(task["id"]), confirm_large_download=True)
        self.assertEqual(retried["trigger_type"], "retry")

    def test_retry_scheduled_download_keeps_download_caps(self) -> None:
        source = create_source("manual", self.source_urls[2])
        task = create_source_bulk_task(
            "download_missing",
            source_ids=[int(source["id"])],
            options={"scheduled": True, "max_downloads_per_source": 50, "max_downloads_per_task": 1000},
            trigger_type="scheduled",
        )
        item_id = int(task["items"][0]["id"])
        with connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "update source_bulk_task_items set status = 'failed', finished_at = now() where id = %s",
                    (item_id,),
                )
                cur.execute(
                    "update source_bulk_tasks set status = 'completed_with_issues', finished_at = now() where id = %s",
                    (task["id"],),
                )
            conn.commit()
        retried = retry_source_bulk_task(int(task["id"]))

        with patch(
            "xarchiver.services.source_bulk_tasks.submit_source_downloads",
            return_value={"run_id": None, "submitted_count": 0},
        ) as submit:
            advance_source_bulk_tasks()

        self.assertTrue(retried["options"]["scheduled"])
        self.assertEqual(submit.call_args.kwargs["limit"], 50)

    def test_auth_circuit_breaker_requires_three_consecutive_failures(self) -> None:
        sources = [create_source("user_media", url) for url in self.source_urls[0:2] + self.source_urls[3:6]]
        task = create_source_bulk_task(
            "refresh_latest",
            source_ids=[int(source["id"]) for source in sources],
        )
        item_ids = [int(item["id"]) for item in task["items"]]
        outcomes = [
            ("failed", "auth_required"),
            ("succeeded", None),
            ("failed", "rate_limited"),
            ("succeeded", None),
            ("failed", "auth_required"),
        ]
        finished_at = datetime.now(UTC) - timedelta(minutes=5)
        with connect() as conn:
            with conn.cursor() as cur:
                for offset, (item_id, outcome) in enumerate(zip(item_ids, outcomes, strict=True)):
                    cur.execute(
                        """
                        update source_bulk_task_items
                        set status = %s, error_category = %s, finished_at = %s
                        where id = %s
                        """,
                        (outcome[0], outcome[1], finished_at + timedelta(seconds=offset), item_id),
                    )
            conn.commit()

        self.assertFalse(circuit_breaker_triggered(int(task["id"])))

        with connect() as conn:
            with conn.cursor() as cur:
                for offset, item_id in enumerate(item_ids[-3:]):
                    cur.execute(
                        """
                        update source_bulk_task_items
                        set status = 'failed', error_category = 'auth_required', finished_at = %s
                        where id = %s
                        """,
                        (finished_at + timedelta(minutes=1, seconds=offset), item_id),
                    )
            conn.commit()

        self.assertTrue(circuit_breaker_triggered(int(task["id"])))

    def test_first_discovery_keeps_exact_scan_run_association(self) -> None:
        source = create_source("user_media", self.source_urls[0])
        record_source_discoveries(
            int(source["id"]),
            [self.record(self.tweet_ids[0])],
        )
        task = create_source_bulk_task(
            "refresh_and_download_new",
            source_ids=[int(source["id"])],
        )
        advance_source_bulk_tasks()
        item_id = int(task["items"][0]["id"])
        scan_run_id = start_source_scan_run(
            int(source["id"]),
            "latest_refresh",
            {"start": 1, "end": 20, "limit": 20},
            {},
            bulk_task_item_id=item_id,
        )

        record_source_discoveries(
            int(source["id"]),
            [self.record(self.tweet_ids[0]), self.record(self.tweet_ids[1])],
            scan_run_id=scan_run_id,
        )

        with connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    select tweet_id, first_discovered_scan_run_id
                    from source_discovered_tweets
                    where source_id = %s
                    order by tweet_id
                    """,
                    (source["id"],),
                )
                rows = cur.fetchall()
        self.assertIsNone(rows[0]["first_discovered_scan_run_id"])
        self.assertEqual(rows[1]["first_discovered_scan_run_id"], scan_run_id)

    def test_schedule_policy_is_disabled_by_default_and_can_be_enabled(self) -> None:
        source = create_source("user_media", self.source_urls[0])

        policy = create_source_schedule_policy(
            label="test-bulk-daily",
            action="refresh_and_download_new",
            frequency_kind="daily",
            local_time="03:30",
            source_ids=[int(source["id"])],
        )

        self.assertFalse(policy["enabled"])
        self.assertIsNone(policy["next_run_at"])
        self.assertEqual(policy["source_ids"], [source["id"]])

        updated = update_source_schedule_policy(int(policy["id"]), {"enabled": True})
        persisted = get_source_schedule_policy(int(policy["id"]))
        self.assertTrue(updated["enabled"])
        self.assertIsNotNone(updated["next_run_at"])
        self.assertEqual(persisted["source_ids"], [source["id"]])

    def test_schedule_policy_creation_rolls_back_when_source_snapshot_fails(self) -> None:
        source = create_source("user_media", self.source_urls[0])
        with (
            patch(
                "xarchiver.services.source_bulk_tasks.resolve_source_ids",
                side_effect=ValueError("source_bulk_task_too_many_sources"),
            ),
            self.assertRaisesRegex(ValueError, "source_bulk_task_too_many_sources"),
        ):
            create_source_schedule_policy(
                label="test-bulk-atomic",
                action="refresh_latest",
                frequency_kind="interval",
                interval_minutes=360,
                source_ids=[int(source["id"])],
            )

        with connect() as conn:
            with conn.cursor() as cur:
                cur.execute("select count(*)::int as count from source_schedule_policies where label = 'test-bulk-atomic'")
                count = cur.fetchone()["count"]
        self.assertEqual(count, 0)

    def test_due_schedule_coalesces_while_previous_task_is_active(self) -> None:
        source = create_source("user_media", self.source_urls[0])
        policy = create_source_schedule_policy(
            label="test-bulk-coalesce",
            action="refresh_latest",
            frequency_kind="interval",
            interval_minutes=360,
            enabled=True,
            source_ids=[int(source["id"])],
        )
        due_at = datetime.now(UTC) - timedelta(minutes=1)
        with connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "update source_schedule_policies set next_run_at = %s where id = %s",
                    (due_at, policy["id"]),
                )
            conn.commit()

        self.assertEqual(process_due_source_schedules(), 1)

        with connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "update source_schedule_policies set next_run_at = %s where id = %s",
                    (due_at, policy["id"]),
                )
            conn.commit()
        self.assertEqual(process_due_source_schedules(), 0)

        with connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "select next_run_at from source_schedule_policies where id = %s",
                    (policy["id"],),
                )
                pending_run_at = cur.fetchone()["next_run_at"]
                cur.execute(
                    "select count(*)::int as count from source_bulk_tasks where schedule_policy_id = %s",
                    (policy["id"],),
                )
                task_count = cur.fetchone()["count"]
                cur.execute(
                    """
                    update source_bulk_tasks
                    set status = 'completed', finished_at = now()
                    where schedule_policy_id = %s
                    """,
                    (policy["id"],),
                )
            conn.commit()
        self.assertEqual(pending_run_at, due_at)
        self.assertEqual(task_count, 1)

        self.assertEqual(process_due_source_schedules(), 1)
        with connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "select count(*)::int as count from source_bulk_tasks where schedule_policy_id = %s",
                    (policy["id"],),
                )
                task_count = cur.fetchone()["count"]
        self.assertEqual(task_count, 2)

    def test_schedule_download_caps_cannot_be_raised(self) -> None:
        source = create_source("user_media", self.source_urls[0])

        policy = create_source_schedule_policy(
            label="test-bulk-caps",
            action="refresh_and_download_new",
            frequency_kind="interval",
            interval_minutes=360,
            max_downloads_per_source=5000,
            max_downloads_per_task=50000,
            source_ids=[int(source["id"])],
        )

        self.assertEqual(policy["max_downloads_per_source"], 50)
        self.assertEqual(policy["max_downloads_per_task"], 1000)
