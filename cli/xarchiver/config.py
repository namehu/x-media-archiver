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
    retry_backoff_minutes: int = Field(default=15, alias="RETRY_BACKOFF_MINUTES")
    stuck_timeout_minutes: int = Field(default=120, alias="STUCK_TIMEOUT_MINUTES")
    api_host: str = Field(default="127.0.0.1", alias="API_HOST")
    api_port: int = Field(default=8000, alias="API_PORT")

    sql_dir: Path = Path("/app/sql")


@lru_cache
def get_settings() -> Settings:
    return Settings()
