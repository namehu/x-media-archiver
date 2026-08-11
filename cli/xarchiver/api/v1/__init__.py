"""v1 版本 API 路由模块导出入口。"""

from xarchiver.api.v1 import (
    actions,
    archive_runs,
    library,
    log_streams,
    maintenance,
    misc,
    settings,
    source_tasks,
    sources,
)

__all__ = [
    "actions",
    "archive_runs",
    "library",
    "log_streams",
    "maintenance",
    "misc",
    "settings",
    "source_tasks",
    "sources",
]
