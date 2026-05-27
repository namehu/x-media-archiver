from xarchiver.db import connect


def get_status_counts() -> dict[str, int]:
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute("select download_status, count(*) as count from tweets group by download_status")
            return {row["download_status"]: row["count"] for row in cur.fetchall()}


def get_media_count() -> int:
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute("select count(*) as count from media_assets")
            return int(cur.fetchone()["count"])


def get_media_status_counts() -> dict[str, int]:
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute("select download_status, count(*) as count from media_assets group by download_status")
            return {row["download_status"]: int(row["count"]) for row in cur.fetchall()}
