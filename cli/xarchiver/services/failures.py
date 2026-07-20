"""失败记录页面与导出视图使用的只读服务。"""

from __future__ import annotations

from xarchiver.exporter import count_failure_rows, fetch_failure_rows
from xarchiver.row_models import FailureRow


def list_failures(limit: int = 100, offset: int = 0) -> dict[str, object]:
    """返回带总数信息的失败记录分页结果。"""

    rows: list[FailureRow] = fetch_failure_rows(limit=limit, offset=offset)
    total_count = count_failure_rows()
    return {"rows": rows, "count": len(rows), "total_count": total_count, "limit": limit, "offset": offset}
