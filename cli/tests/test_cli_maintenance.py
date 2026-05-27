import unittest

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


if __name__ == "__main__":
    unittest.main()
