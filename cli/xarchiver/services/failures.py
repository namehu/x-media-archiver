from __future__ import annotations

from xarchiver.exporter import count_failure_rows, fetch_failure_rows


def list_failures(limit: int = 100, offset: int = 0) -> dict[str, object]:
    rows = fetch_failure_rows(limit=limit, offset=offset)
    total_count = count_failure_rows()
    return {"rows": rows, "count": len(rows), "total_count": total_count, "limit": limit, "offset": offset}
