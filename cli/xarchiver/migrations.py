from hashlib import sha256
from pathlib import Path

from xarchiver.db import connect


CREATE_MIGRATIONS_TABLE_SQL = """
    create table if not exists xarchiver_schema_migrations (
      filename text primary key,
      checksum text not null,
      applied_at timestamptz not null default now()
    )
"""


def migrate(sql_dir: Path) -> list[Path]:
    applied: list[Path] = []
    files = sorted(sql_dir.glob("*.sql"))

    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(CREATE_MIGRATIONS_TABLE_SQL)
        conn.commit()

        for file in files:
            checksum = file_checksum(file)
            with conn.cursor() as cur:
                cur.execute(
                    "select checksum from xarchiver_schema_migrations where filename = %s",
                    (file.name,),
                )
                row = cur.fetchone()
                if row:
                    if row["checksum"] != checksum:
                        raise RuntimeError(
                            f"Migration checksum mismatch for {file.name}. "
                            "Do not edit an applied migration; add a new SQL migration file."
                        )
                    continue

                cur.execute(file.read_text(encoding="utf-8"))
                cur.execute(
                    """
                    insert into xarchiver_schema_migrations (filename, checksum)
                    values (%s, %s)
                    """,
                    (file.name, checksum),
                )
            conn.commit()
            applied.append(file)

    return applied


def file_checksum(file: Path) -> str:
    return sha256(file.read_bytes()).hexdigest()

