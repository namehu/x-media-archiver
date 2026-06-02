from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

from sqlalchemy import bindparam, func, select
from sqlalchemy.dialects.postgresql import insert

from xarchiver.config import Settings
from xarchiver.db import connect
from xarchiver.sql_builder import compile_query
from xarchiver.tables import cookie_config


@dataclass(frozen=True)
class CookieContent:
    content: str
    source: str
    label: str | None = None
    updated_at: datetime | None = None


def normalize_cookie_content(content: str | None) -> str | None:
    if content is None:
        return None
    normalized = content.strip()
    return normalized or None


def normalize_label(label: str | None) -> str | None:
    if label is None:
        return None
    normalized = label.strip()
    return normalized or None


def get_cookie_config(settings: Settings | None = None) -> dict[str, object]:
    row = fetch_cookie_row()
    db_content = normalize_cookie_content(row.get("content") if row else None)
    if db_content is not None:
        return {
            "configured": True,
            "source": "database",
            "label": normalize_label(row.get("label") if row else None),
            "updated_at": row.get("updated_at") if row else None,
        }

    if settings is not None and has_cookie_file(settings.cookie_file):
        return {
            "configured": True,
            "source": "file",
            "label": None,
            "updated_at": None,
        }

    return {"configured": False, "source": "none", "label": None, "updated_at": None}


def save_cookie_content(content: str, label: str | None = None) -> dict[str, object]:
    normalized_content = normalize_cookie_content(content)
    normalized_label = normalize_label(label)
    sql, params = build_save_cookie_query(normalized_content, normalized_label)
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            row = dict(cur.fetchone())
        conn.commit()
    return {
        "configured": normalize_cookie_content(row.get("content")) is not None,
        "source": "database" if normalize_cookie_content(row.get("content")) is not None else "none",
        "label": normalize_label(row.get("label")),
        "updated_at": row.get("updated_at"),
    }


def clear_cookie_content(settings: Settings | None = None) -> dict[str, object]:
    sql, params = build_save_cookie_query(None, None)
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params)
        conn.commit()
    return get_cookie_config(settings)


def resolve_cookie_content(settings: Settings) -> CookieContent | None:
    row = fetch_cookie_row()
    db_content = normalize_cookie_content(row.get("content") if row else None)
    if db_content is not None:
        return CookieContent(
            content=db_content,
            source="database",
            label=normalize_label(row.get("label") if row else None),
            updated_at=row.get("updated_at") if row else None,
        )

    if not has_cookie_file(settings.cookie_file):
        return None

    content = normalize_cookie_content(settings.cookie_file.read_text(encoding="utf-8"))
    if content is None:
        return None
    return CookieContent(content=content, source="file")


def fetch_cookie_row() -> dict[str, object] | None:
    statement = (
        select(cookie_config.c.content, cookie_config.c.label, cookie_config.c.updated_at)
        .where(cookie_config.c.id == bindparam("cookie_config_id", 1))
    )
    sql, params = compile_query(statement)
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            row = cur.fetchone()
            return dict(row) if row else None


def build_save_cookie_query(content: str | None, label: str | None) -> tuple[str, dict[str, object]]:
    statement = (
        insert(cookie_config)
        .values(
            id=bindparam("cookie_config_id", 1),
            content=bindparam("cookie_content", content),
            label=bindparam("cookie_label", label),
            updated_at=func.now(),
        )
        .on_conflict_do_update(
            index_elements=[cookie_config.c.id],
            set_={
                "content": bindparam("cookie_content", content),
                "label": bindparam("cookie_label", label),
                "updated_at": func.now(),
            },
        )
        .returning(cookie_config.c.content, cookie_config.c.label, cookie_config.c.updated_at)
    )
    return compile_query(statement)


def has_cookie_file(path: Path) -> bool:
    return path.exists() and path.is_file() and path.stat().st_size > 0
