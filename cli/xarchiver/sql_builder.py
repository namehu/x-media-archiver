from __future__ import annotations

from sqlalchemy.dialects import postgresql
from sqlalchemy.sql import Executable

POSTGRES_DIALECT = postgresql.dialect(paramstyle="pyformat")


def compile_query(statement: Executable) -> tuple[str, dict[str, object]]:
    compiled = statement.compile(
        dialect=POSTGRES_DIALECT,
        compile_kwargs={"render_postcompile": True},
    )
    return str(compiled), dict(compiled.params)
