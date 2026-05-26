import unittest

from xarchiver.workflow import summarize_download_result


class WorkflowTests(unittest.TestCase):
    def test_summarize_download_result_keeps_compact_fields(self) -> None:
        self.assertEqual(
            summarize_download_result(
                {
                    "job_id": 12,
                    "count": 3,
                    "exit_code": 0,
                    "input_path": "/tmp/input.txt",
                    "media_backfill": {"upserted": 2},
                }
            ),
            {
                "job_id": 12,
                "count": 3,
                "exit_code": 0,
                "media_backfill": {"upserted": 2},
            },
        )


if __name__ == "__main__":
    unittest.main()
