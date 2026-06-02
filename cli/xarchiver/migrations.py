from pathlib import Path

from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine, text

from xarchiver.config import get_settings


def migrate() -> list[Path]:
    """Upgrade the database to the latest Alembic revision."""
    settings = get_settings()
    config = alembic_config(settings.database_url)
    pending = pending_upgrade_paths(config, settings.database_url)
    command.upgrade(config, "head")
    return pending


def downgrade(revision: str = "-1") -> None:
    settings = get_settings()
    command.downgrade(alembic_config(settings.database_url), revision)


def alembic_config(database_url: str) -> Config:
    config = Config()
    config.set_main_option("script_location", str(Path(__file__).with_name("alembic")))
    config.set_main_option("sqlalchemy.url", sqlalchemy_url(database_url))
    return config


def pending_upgrade_paths(config: Config, database_url: str) -> list[Path]:
    script = ScriptDirectory.from_config(config)
    head_revision = script.get_current_head()
    current_revision = current_alembic_revision(database_url)
    if current_revision == head_revision:
        return []

    lower = current_revision or "base"
    revisions = list(script.iterate_revisions(head_revision, lower))
    revisions.reverse()
    return [Path(revision.path) for revision in revisions]


def current_alembic_revision(database_url: str) -> str | None:
    engine = create_engine(sqlalchemy_url(database_url), pool_pre_ping=True)
    try:
        with engine.connect() as conn:
            exists = conn.execute(
                text(
                    """
                    select to_regclass('public.alembic_version') is not null
                    """
                )
            ).scalar()
            if not exists:
                return None
            return conn.execute(
                text("select version_num from alembic_version")
            ).scalar_one_or_none()
    finally:
        engine.dispose()


def sqlalchemy_url(database_url: str) -> str:
    if database_url.startswith("postgresql://"):
        return database_url.replace("postgresql://", "postgresql+psycopg://", 1)
    return database_url
