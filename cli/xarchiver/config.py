from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    database_url: str = Field(alias="DATABASE_URL")
    archive_dir: Path = Field(default=Path("/app/archive"), alias="ARCHIVE_DIR")
    cookie_file: Path = Field(default=Path("/app/secrets/cookies.txt"), alias="COOKIE_FILE")
    default_download_engine: str = Field(default="gallery-dl", alias="DEFAULT_DOWNLOAD_ENGINE")
    retry_limit: int = Field(default=3, alias="RETRY_LIMIT")

    sql_dir: Path = Path("/app/sql")


@lru_cache
def get_settings() -> Settings:
    return Settings()

