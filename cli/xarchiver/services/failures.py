from __future__ import annotations

from xarchiver.exporter import fetch_failure_rows


def list_failures(limit: int = 100) -> list[dict[str, object]]:
    return fetch_failure_rows()[:limit]

