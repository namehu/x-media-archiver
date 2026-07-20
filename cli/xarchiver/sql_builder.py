"""SQLAlchemy Core 语句编译辅助函数。"""

from __future__ import annotations

from sqlalchemy.dialects import postgresql
from sqlalchemy.sql import Executable

POSTGRES_DIALECT = postgresql.dialect(paramstyle="pyformat")


def compile_query(statement: Executable) -> tuple[str, dict[str, object]]:
    """把 SQLAlchemy 语句编译成 PostgreSQL SQL 与参数字典。"""

    compiled = statement.compile(
        dialect=POSTGRES_DIALECT,
        compile_kwargs={"render_postcompile": True},
    )
    return str(compiled), dict(compiled.params)
