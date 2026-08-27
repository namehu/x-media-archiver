import unittest

from xarchiver.core.events import EventBroker
from xarchiver.core.runtime_channel import project_runtime_events


class RuntimeProjectionTests(unittest.TestCase):
    def test_projection_coalesces_entities_and_excludes_operation_logs(self) -> None:
        broker = EventBroker()
        events = [
            broker.publish(
                "archive_runs",
                "archive.run.progress",
                {
                    "run": {"id": 7, "status": "running"},
                    "items": [{"archive_run_item_id": 11, "status": "processing"}],
                },
            ),
            broker.publish(
                "archive_runs",
                "archive.run.progress",
                {
                    "run": {"id": 7, "speed_bps": 512},
                    "items": [{"archive_run_item_id": 11, "downloaded_bytes": 1024}],
                },
            ),
            broker.publish(
                "logs",
                "operation.log.appended",
                {"stream_id": 9, "scope_id": 3, "message": "must not escape"},
            ),
        ]

        projection = project_runtime_events(events)

        self.assertEqual(projection.sequence, events[-1].id)
        self.assertEqual(projection.runs[7]["status"], "running")
        self.assertEqual(projection.runs[7]["speed_bps"], 512)
        self.assertEqual(projection.items[11]["downloaded_bytes"], 1024)
        self.assertEqual(projection.invalidations, [])
        self.assertNotIn("must not escape", str(projection.patch_payload()))

    def test_projection_builds_sparse_scan_patch_and_compact_invalidation(self) -> None:
        broker = EventBroker()
        event = broker.publish(
            "source_scans",
            "source.scan.completed",
            {
                "source_id": 4,
                "scan_run_id": 8,
                "status": "completed_end_of_source",
                "new_tweet_count": 20,
                "error_message": None,
            },
        )

        projection = project_runtime_events([event])

        self.assertEqual(projection.scans[8]["status"], "completed_end_of_source")
        self.assertEqual(projection.scans[8]["new_tweet_count"], 20)
        self.assertEqual(
            projection.invalidations,
            [
                {
                    "topic": "source_scans",
                    "type": "source.scan.completed",
                    "payload": {"source_id": 4, "scan_run_id": 8},
                }
            ],
        )

    def test_library_invalidation_preserves_operation_and_deleted_tweets(self) -> None:
        broker = EventBroker()
        event = broker.publish(
            "library",
            "library.media_deleted",
            {
                "operation_id": "9b10e5d9-c187-480d-a0d5-7fac4edc0be1",
                "tweet_ids": ["100", "200"],
                "deleted_count": 3,
            },
        )

        projection = project_runtime_events([event])

        self.assertEqual(
            projection.invalidations,
            [
                {
                    "topic": "library",
                    "type": "library.media_deleted",
                    "payload": {
                        "operation_id": "9b10e5d9-c187-480d-a0d5-7fac4edc0be1",
                        "tweet_ids": ["100", "200"],
                    },
                }
            ],
        )

    def test_projection_coalesces_preview_progress_without_invalidating(self) -> None:
        broker = EventBroker()
        events = [
            broker.publish(
                "media_previews",
                "media_preview_job.progress",
                {"preview_job_id": 12, "preview_job": {"id": 12, "status": "running", "scanned_count": 4}},
            ),
            broker.publish(
                "media_previews",
                "media_preview_job.progress",
                {"preview_job_id": 12, "preview_job": {"id": 12, "generated_count": 3}},
            ),
        ]

        projection = project_runtime_events(events)

        self.assertEqual(projection.preview_jobs[12]["scanned_count"], 4)
        self.assertEqual(projection.preview_jobs[12]["generated_count"], 3)
        self.assertEqual(projection.invalidations, [])


if __name__ == "__main__":
    unittest.main()
