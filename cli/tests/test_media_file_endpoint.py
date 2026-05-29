import asyncio
import importlib.util
import sys
import types
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import patch

from fastapi import HTTPException

# Importing xarchiver.api.v1.misc runs the package initializer, which may pull in
# optional DB pool work from sibling modules in a mixed local worktree.
if importlib.util.find_spec("psycopg_pool") is None:
    psycopg_pool = types.ModuleType("psycopg_pool")

    class ConnectionPool:
        pass

    psycopg_pool.ConnectionPool = ConnectionPool
    sys.modules["psycopg_pool"] = psycopg_pool

from xarchiver.api.v1.misc import media_file


async def _read_stream(response) -> bytes:
    chunks = []
    async for chunk in response.body_iterator:
        chunks.append(chunk)
    return b"".join(chunks)


class MediaFileEndpointTests(TestCase):
    def setUp(self) -> None:
        self.tmp = TemporaryDirectory()
        self.archive_dir = Path(self.tmp.name) / "archive"
        self.media_path = self.archive_dir / "media" / "alice" / "1.mp4"
        self.media_path.parent.mkdir(parents=True)
        self.content = bytes(range(32))
        self.media_path.write_bytes(self.content)
        self.settings = SimpleNamespace(archive_dir=self.archive_dir)

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def _response(self, relative_path: str = "media/alice/1.mp4", range_header: str | None = None):
        with patch("xarchiver.api.v1.misc.get_settings", return_value=self.settings):
            return media_file(relative_path, range_header=range_header)

    def test_full_response_streams_file_with_common_headers(self) -> None:
        response = self._response()

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["accept-ranges"], "bytes")
        self.assertEqual(response.headers["content-length"], str(len(self.content)))
        self.assertEqual(response.headers["content-type"], "video/mp4")
        self.assertEqual(asyncio.run(_read_stream(response)), self.content)

    def test_explicit_range_returns_partial_content(self) -> None:
        response = self._response(range_header="bytes=2-5")

        self.assertEqual(response.status_code, 206)
        self.assertEqual(response.headers["accept-ranges"], "bytes")
        self.assertEqual(response.headers["content-range"], f"bytes 2-5/{len(self.content)}")
        self.assertEqual(response.headers["content-length"], "4")
        self.assertEqual(asyncio.run(_read_stream(response)), self.content[2:6])

    def test_open_ended_range_returns_through_end(self) -> None:
        response = self._response(range_header="bytes=30-")

        self.assertEqual(response.status_code, 206)
        self.assertEqual(response.headers["content-range"], f"bytes 30-31/{len(self.content)}")
        self.assertEqual(response.headers["content-length"], "2")
        self.assertEqual(asyncio.run(_read_stream(response)), self.content[30:])

    def test_suffix_range_returns_last_bytes(self) -> None:
        response = self._response(range_header="bytes=-4")

        self.assertEqual(response.status_code, 206)
        self.assertEqual(response.headers["content-range"], f"bytes 28-31/{len(self.content)}")
        self.assertEqual(response.headers["content-length"], "4")
        self.assertEqual(asyncio.run(_read_stream(response)), self.content[-4:])

    def test_unsatisfiable_range_returns_416_headers(self) -> None:
        response = self._response(range_header="bytes=32-40")

        self.assertEqual(response.status_code, 416)
        self.assertEqual(response.headers["accept-ranges"], "bytes")
        self.assertEqual(response.headers["content-range"], f"bytes */{len(self.content)}")
        self.assertEqual(response.headers["content-length"], "0")
        self.assertEqual(asyncio.run(_read_stream(response)), b"")

    def test_path_escape_is_rejected(self) -> None:
        with self.assertRaises(HTTPException) as ctx:
            self._response(relative_path="../secrets/cookies.txt")

        self.assertEqual(ctx.exception.status_code, 400)


if __name__ == "__main__":
    unittest.main()
