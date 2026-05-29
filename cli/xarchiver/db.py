from collections.abc import Iterator
from contextlib import contextmanager

import psycopg
from psycopg_pool import ConnectionPool
from psycopg.rows import dict_row

from xarchiver.config import get_settings

_pool: ConnectionPool | None = None
_pool_conninfo: str | None = None
_POOL_MIN_SIZE = 2
_POOL_MAX_SIZE = 10


def get_pool() -> ConnectionPool:
    global _pool, _pool_conninfo
    settings = get_settings()
    if _pool is None or _pool_conninfo != settings.database_url:
        _pool = ConnectionPool(
            conninfo=settings.database_url,
            min_size=_POOL_MIN_SIZE,
            max_size=_POOL_MAX_SIZE,
            kwargs={"row_factory": dict_row},
            open=False,
        )
        _pool_conninfo = settings.database_url
    return _pool


def open_pool() -> None:
    pool = get_pool()
    if pool.closed:
        pool.open()


def close_pool() -> None:
    global _pool, _pool_conninfo
    if _pool is not None and not _pool.closed:
        _pool.close()
    _pool = None
    _pool_conninfo = None


def get_pool_stats() -> dict[str, int]:
    pool = get_pool()
    stats = pool.get_stats()
    pool_size = int(stats.get("pool_size", 0))
    available = int(stats.get("pool_available", 0))
    return {
        "active": max(pool_size - available, 0),
        "idle": available,
        "waiting": int(stats.get("requests_waiting", 0)),
        "min_size": _POOL_MIN_SIZE,
        "max_size": _POOL_MAX_SIZE,
    }


@contextmanager
def connect() -> Iterator[psycopg.Connection]:
    settings = get_settings()
    pool = _pool
    if pool is not None and not pool.closed:
        with pool.connection() as conn:
            yield conn
    else:
        with psycopg.connect(settings.database_url, row_factory=dict_row) as conn:
            yield conn


def execute_sql(sql: str) -> None:
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(sql)
        conn.commit()
