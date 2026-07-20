from functools import lru_cache
from pathlib import Path

"""运行配置定义与加载入口。"""

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """从环境变量和 `.env` 文件加载的全局配置。"""

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    database_url: str = Field(alias="DATABASE_URL")
    archive_dir: Path = Field(default=Path("/app/archive"), alias="ARCHIVE_DIR")
    cookie_file: Path = Field(default=Path("/app/secrets/cookies.txt"), alias="COOKIE_FILE")
    default_download_engine: str = Field(default="gallery-dl", alias="DEFAULT_DOWNLOAD_ENGINE")
    retry_limit: int = Field(default=3, alias="RETRY_LIMIT")
    retry_backoff_minutes: int = Field(default=15, alias="RETRY_BACKOFF_MINUTES")
    stuck_timeout_minutes: int = Field(default=120, alias="STUCK_TIMEOUT_MINUTES")
    queue_batch_size: int = Field(default=20, alias="QUEUE_BATCH_SIZE")
    downloader_sleep_min_seconds: float = Field(default=0.0, alias="DOWNLOADER_SLEEP_MIN_SECONDS")
    downloader_sleep_max_seconds: float = Field(default=3.0, alias="DOWNLOADER_SLEEP_MAX_SECONDS")
    downloader_progress_fallback_interval_seconds: float = Field(
        default=10.0,
        alias="DOWNLOADER_PROGRESS_FALLBACK_INTERVAL_SECONDS",
        ge=0.0,
        le=300.0,
    )
    source_scan_batch_size: int = Field(default=20, alias="SOURCE_SCAN_BATCH_SIZE")
    source_scan_sleep_min_seconds: float = Field(default=0.0, alias="SOURCE_SCAN_SLEEP_MIN_SECONDS")
    source_scan_sleep_max_seconds: float = Field(default=3.0, alias="SOURCE_SCAN_SLEEP_MAX_SECONDS")
    source_scan_http_timeout_seconds: float = Field(
        default=15.0,
        alias="SOURCE_SCAN_HTTP_TIMEOUT_SECONDS",
        ge=1.0,
        le=120.0,
    )
    source_scan_http_retries: int = Field(default=2, alias="SOURCE_SCAN_HTTP_RETRIES", ge=0, le=10)
    operation_log_max_bytes: int = Field(default=10 * 1024 * 1024, alias="OPERATION_LOG_MAX_BYTES")
    api_host: str = Field(default="127.0.0.1", alias="API_HOST")
    api_port: int = Field(default=18000, alias="API_PORT")
    auth_mode: str = Field(default="password", alias="AUTH_MODE", pattern="^(password|disabled)$")
    auth_cookie_secure: bool = Field(default=True, alias="AUTH_COOKIE_SECURE")
    auth_session_ttl_hours: int = Field(default=168, alias="AUTH_SESSION_TTL_HOURS", ge=1, le=8760)


@lru_cache
def get_settings() -> Settings:
    """返回带缓存的全局配置实例。"""

    return Settings()
