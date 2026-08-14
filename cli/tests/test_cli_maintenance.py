import unittest
from unittest.mock import patch

from typer.testing import CliRunner

from xarchiver.cli import app


class CliMaintenanceTests(unittest.TestCase):
    def test_backfill_requires_full_confirmation_flag(self) -> None:
        result = CliRunner().invoke(app, ["backfill-media"])

        self.assertNotEqual(result.exit_code, 0)
        self.assertIn("--full", result.output)
        self.assertIn("confirm", result.output)

    def test_verify_requires_full_confirmation_flag(self) -> None:
        result = CliRunner().invoke(app, ["verify"])

        self.assertNotEqual(result.exit_code, 0)
        self.assertIn("--full", result.output)
        self.assertIn("confirm", result.output)

    def test_hashtag_backfill_defaults_to_dry_run_json(self) -> None:
        response = {
            "run_id": 7,
            "mode": "dry_run",
            "status": "completed",
            "would_insert_relationship_count": 3,
            "inserted_relationship_count": 0,
        }
        with patch("xarchiver.cli.run_hashtag_backfill", return_value=response) as run:
            result = CliRunner().invoke(app, ["backfill-hashtags"])

        self.assertEqual(result.exit_code, 0)
        self.assertIn('"mode": "dry_run"', result.stdout)
        self.assertIn('"inserted_relationship_count": 0', result.stdout)
        run.assert_called_once()
        self.assertFalse(run.call_args.kwargs["apply"])

    def test_hashtag_backfill_apply_requires_explicit_confirmation(self) -> None:
        result = CliRunner().invoke(app, ["backfill-hashtags", "--apply"])

        self.assertNotEqual(result.exit_code, 0)
        self.assertIn("--apply --confirm", result.output)


if __name__ == "__main__":
    unittest.main()
