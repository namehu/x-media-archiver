from pathlib import Path

from xarchiver.db import execute_sql


def migrate(sql_dir: Path) -> list[Path]:
    files = sorted(sql_dir.glob("*.sql"))
    for file in files:
        execute_sql(file.read_text(encoding="utf-8"))
    return files

