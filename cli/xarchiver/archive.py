from pathlib import Path


ARCHIVE_SUBDIRS = (
    "raw/imports",
    "raw/downloader_inputs",
    "media",
    "state",
    "logs",
    "exports",
)


def ensure_archive_dirs(archive_dir: Path) -> None:
    archive_dir.mkdir(parents=True, exist_ok=True)
    for subdir in ARCHIVE_SUBDIRS:
        (archive_dir / subdir).mkdir(parents=True, exist_ok=True)


def normalize_path(path: Path) -> str:
    return path.as_posix()
