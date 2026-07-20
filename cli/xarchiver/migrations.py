from pathlib import Path

"""Alembic 迁移辅助函数。"""

from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine, text

from xarchiver.config import get_settings


def migrate() -> list[Path]:
    """把数据库升级到最新 Alembic 版本。"""

    settings = get_settings()
    config = alembic_config(settings.database_url)
    pending = pending_upgrade_paths(config, settings.database_url)
    command.upgrade(config, "head")
    return pending


def downgrade(revision: str = "-1") -> None:
    """把数据库回退到指定 Alembic 版本。"""

    settings = get_settings()
    command.downgrade(alembic_config(settings.database_url), revision)


def alembic_config(database_url: str) -> Config:
    """构造运行 Alembic 命令所需配置对象。"""

    config = Config()
    config.set_main_option("script_location", str(Path(__file__).with_name("alembic")))
    config.set_main_option("sqlalchemy.url", sqlalchemy_url(database_url))
    return config


def pending_upgrade_paths(config: Config, database_url: str) -> list[Path]:
    """返回当前数据库到 head 之间尚未执行的迁移文件。"""

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
    """读取数据库当前记录的 Alembic revision。"""

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
    """把通用 PostgreSQL 连接串转换成 SQLAlchemy/psycopg 形式。"""

    if database_url.startswith("postgresql://"):
        return database_url.replace("postgresql://", "postgresql+psycopg://", 1)
    return database_url
