from pathlib import Path

"""归档目录结构辅助函数。"""

ARCHIVE_SUBDIRS = (
    "raw/imports",
    "raw/downloader_inputs",
    "media",
    "state",
    "logs",
    "exports",
)


def ensure_archive_dirs(archive_dir: Path) -> None:
    """确保 archive 根目录及约定子目录全部存在。"""

    archive_dir.mkdir(parents=True, exist_ok=True)
    for subdir in ARCHIVE_SUBDIRS:
        (archive_dir / subdir).mkdir(parents=True, exist_ok=True)


def normalize_path(path: Path) -> str:
    """把本地路径统一转换成 POSIX 风格字符串。"""

    return path.as_posix()
