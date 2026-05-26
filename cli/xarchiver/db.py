from collections.abc import Iterator
from contextlib import contextmanager

import psycopg
from psycopg.rows import dict_row

from xarchiver.config import get_settings


@contextmanager
def connect() -> Iterator[psycopg.Connection]:
    settings = get_settings()
    with psycopg.connect(settings.database_url, row_factory=dict_row) as conn:
        yield conn


def execute_sql(sql: str) -> None:
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(sql)
        conn.commit()

