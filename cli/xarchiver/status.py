"""归档状态统计辅助函数。"""

from xarchiver.db import connect
from xarchiver.row_models import DownloadStatusCountRow


def get_status_counts() -> dict[str, int]:
    """统计 tweets 表中各下载状态的数量。"""

    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute("select download_status, count(*) as count from tweets group by download_status")
            return {
                row.download_status: row.count
                for row in (DownloadStatusCountRow.model_validate(dict(row)) for row in cur.fetchall())
            }


def get_media_count() -> int:
    """统计媒体资产总数。"""

    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute("select count(*) as count from media_assets")
            return int(cur.fetchone()["count"])


def get_media_status_counts() -> dict[str, int]:
    """统计 media_assets 表中各下载状态的数量。"""

    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute("select download_status, count(*) as count from media_assets group by download_status")
            return {
                row.download_status: row.count
                for row in (DownloadStatusCountRow.model_validate(dict(row)) for row in cur.fetchall())
            }
