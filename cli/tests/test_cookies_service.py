import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

from xarchiver.db import connect
from xarchiver.services.cookies import (
    clear_cookie_content,
    get_cookie_config,
    resolve_cookie_content,
    save_cookie_content,
)


class CookieServiceIntegrationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.clear_db_cookie()

    def tearDown(self) -> None:
        self.clear_db_cookie()

    def clear_db_cookie(self) -> None:
        with connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    create table if not exists cookie_config (
                      id smallint primary key default 1,
                      content text,
                      label text,
                      updated_at timestamptz not null default now(),
                      constraint chk_cookie_config_singleton check (id = 1)
                    )
                    """
                )
                cur.execute(
                    """
                    insert into cookie_config (id, content, label, updated_at)
                    values (1, null, null, now())
                    on conflict (id) do update
                    set content = null,
                        label = null,
                        updated_at = now()
                    """
                )
            conn.commit()

    def test_get_cookie_config_reports_none_without_db_or_file(self) -> None:
        settings = SimpleNamespace(cookie_file=Path("missing-cookies.txt"))

        self.assertEqual(
            get_cookie_config(settings),
            {"configured": False, "source": "none", "label": None, "updated_at": None},
        )
        self.assertIsNone(resolve_cookie_content(settings))

    def test_resolve_cookie_content_uses_file_fallback(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            cookie_file = Path(tmp) / "cookies.txt"
            cookie_file.write_text("# Netscape\n.example\tTRUE\t/\tTRUE\t0\tname\tfile\n", encoding="utf-8")
            settings = SimpleNamespace(cookie_file=cookie_file)

            status = get_cookie_config(settings)
            content = resolve_cookie_content(settings)

        self.assertTrue(status["configured"])
        self.assertEqual(status["source"], "file")
        self.assertIsNotNone(content)
        self.assertEqual(content.source, "file")
        self.assertIn("name\tfile", content.content)

    def test_resolve_cookie_content_prefers_database_over_file(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            cookie_file = Path(tmp) / "cookies.txt"
            cookie_file.write_text("# Netscape\n.example\tTRUE\t/\tTRUE\t0\tname\tfile\n", encoding="utf-8")
            settings = SimpleNamespace(cookie_file=cookie_file)

            save_cookie_content("# Netscape\n.example\tTRUE\t/\tTRUE\t0\tname\tdb\n", "db label")
            status = get_cookie_config(settings)
            content = resolve_cookie_content(settings)

        self.assertTrue(status["configured"])
        self.assertEqual(status["source"], "database")
        self.assertEqual(status["label"], "db label")
        self.assertIsNotNone(content)
        self.assertEqual(content.source, "database")
        self.assertIn("name\tdb", content.content)

    def test_blank_database_content_is_treated_as_unconfigured(self) -> None:
        settings = SimpleNamespace(cookie_file=Path("missing-cookies.txt"))

        status = save_cookie_content("   ", "blank")
        content = resolve_cookie_content(settings)

        self.assertFalse(status["configured"])
        self.assertEqual(status["source"], "none")
        self.assertIsNone(content)

    def test_clear_cookie_content_falls_back_to_file(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            cookie_file = Path(tmp) / "cookies.txt"
            cookie_file.write_text("# Netscape\n.example\tTRUE\t/\tTRUE\t0\tname\tfile\n", encoding="utf-8")
            settings = SimpleNamespace(cookie_file=cookie_file)

            save_cookie_content("# Netscape\n.example\tTRUE\t/\tTRUE\t0\tname\tdb\n", "db label")
            status = clear_cookie_content(settings)
            content = resolve_cookie_content(settings)

        self.assertTrue(status["configured"])
        self.assertEqual(status["source"], "file")
        self.assertIsNotNone(content)
        self.assertEqual(content.source, "file")


if __name__ == "__main__":
    unittest.main()
