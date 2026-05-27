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
    queue_batch_size: int = Field(default=20, alias="QUEUE_BATCH_SIZE")
    downloader_sleep_min_seconds: float = Field(default=2.0, alias="DOWNLOADER_SLEEP_MIN_SECONDS")
    downloader_sleep_max_seconds: float = Field(default=6.0, alias="DOWNLOADER_SLEEP_MAX_SECONDS")
    source_scan_batch_size: int = Field(default=20, alias="SOURCE_SCAN_BATCH_SIZE")
    source_scan_sleep_min_seconds: float = Field(default=20.0, alias="SOURCE_SCAN_SLEEP_MIN_SECONDS")
    source_scan_sleep_max_seconds: float = Field(default=45.0, alias="SOURCE_SCAN_SLEEP_MAX_SECONDS")
    api_host: str = Field(default="127.0.0.1", alias="API_HOST")
    api_port: int = Field(default=8000, alias="API_PORT")

    sql_dir: Path = Path("/app/sql")


@lru_cache
def get_settings() -> Settings:
    return Settings()
