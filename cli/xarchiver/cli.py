"""命令行入口。

使用 Typer 暴露数据库维护、来源管理、下载、导出和本地 API 启动等命令。
"""

from pathlib import Path

import typer
from rich.console import Console
from rich.table import Table

from xarchiver.archive import ensure_archive_dirs
from xarchiver.config import get_settings
from xarchiver.db import execute_sql
from xarchiver.exporter import export_media_gallery
from xarchiver.importer import import_jsonl, import_urls
from xarchiver.migrations import downgrade, migrate
from xarchiver.search import compact_text, search_media
from xarchiver.services.library import list_duplicates
from xarchiver.services.queue import submit_jsonl_file, submit_urls_file
from xarchiver.services.runs import (
    run_backfill,
    run_download,
    run_export_duplicates,
    run_export_failures,
    run_export_media,
    run_recover_interrupted,
    run_requeue,
    run_verify,
)
from xarchiver.services.sources import (
    create_source,
    list_sources,
    scan_source,
    start_source_history_scan,
    stop_source_history_scan,
    submit_discovered_tweets,
    submit_source_records,
    update_source_status,
)
from xarchiver.status import get_media_count, get_status_counts

app = typer.Typer(help="Local-first X/Twitter media archiver.")
db_app = typer.Typer(help="Database commands.")
sources_app = typer.Typer(help="Source collector commands.")
auth_app = typer.Typer(help="Authentication recovery commands.")
app.add_typer(db_app, name="db")
app.add_typer(sources_app, name="sources")
app.add_typer(auth_app, name="auth")

console = Console()


@auth_app.command("reset-password")
def auth_reset_password() -> None:
    """重置管理员密码，并清空现有浏览器会话。"""

    from xarchiver.services.auth import AuthError, reset_password

    password = typer.prompt("New password", hide_input=True)
    confirmation = typer.prompt("Confirm new password", hide_input=True)
    if password != confirmation:
        raise typer.BadParameter("Passwords do not match.")
    try:
        reset_password(password)
    except AuthError as exc:
        raise typer.BadParameter(str(exc)) from exc
    console.print("Administrator password reset. All browser sessions were revoked.")


@app.command()
def init(archive_dir: Path | None = typer.Argument(None, help="Archive directory to initialize.")) -> None:
    """初始化 archive 目录结构。"""

    settings = get_settings()
    target = archive_dir or settings.archive_dir
    ensure_archive_dirs(target)
    console.print(f"Initialized archive directory: {target}")


@db_app.command("migrate")
def db_migrate() -> None:
    """执行数据库迁移。"""

    files = migrate()
    if not files:
        console.print("No pending migrations")
        return
    for file in files:
        console.print(f"Applied migration: {file}")


@db_app.command("downgrade")
def db_downgrade(
    revision: str = typer.Option(
        "-1",
        "--revision",
        "-r",
        help="Alembic target revision, such as -1, base, or 001_initial_schema.",
    ),
) -> None:
    """把数据库回退到指定 Alembic revision。"""

    downgrade(revision)
    console.print(f"Downgraded database to: {revision}")


@db_app.command("reset")
def db_reset(yes: bool = typer.Option(False, "--yes", help="Confirm destructive database reset.")) -> None:
    """危险操作：重建数据库 schema 后重新迁移。"""

    if not yes:
        raise typer.BadParameter("Pass --yes to confirm resetting the database schema.")
    execute_sql(
        """
        drop schema public cascade;
        create schema public;
        grant all on schema public to xarchiver;
        grant all on schema public to public;
        """
    )
    files = migrate()
    console.print("Database schema reset.")
    for file in files:
        console.print(f"Applied migration: {file}")


@app.command("import")
def import_command(path: Path = typer.Argument(..., help="Path to tweets JSONL.")) -> None:
    """导入 JSONL 推文记录。"""

    count = import_jsonl(path)
    console.print(f"Imported {count} tweets from {path}")


@app.command("import-urls")
def import_urls_command(path: Path = typer.Argument(..., help="Path to tweet_urls.txt.")) -> None:
    """导入纯文本 URL 列表。"""

    count = import_urls(path)
    console.print(f"Imported {count} tweet URLs from {path}")


@app.command("archive-urls")
def archive_urls_command(
    path: Path = typer.Argument(..., help="Path to tweet_urls.txt."),
) -> None:
    """把 URL 文件加入归档队列。"""

    result = submit_urls_file(path)
    console.print(result)
    console.print("Queued for processing while `xarchiver serve` is running.")


@app.command("archive-jsonl")
def archive_jsonl_command(
    path: Path = typer.Argument(..., help="Path to tweets JSONL."),
) -> None:
    """把 JSONL 文件加入归档队列。"""

    result = submit_jsonl_file(path)
    console.print(result)
    console.print("Queued for processing while `xarchiver serve` is running.")


@sources_app.command("create")
def source_create_command(
    source_url: str = typer.Argument(..., help="X/Twitter source URL."),
    source_type: str = typer.Option("profile", help="profile, user_media, likes, bookmarks, search, or manual."),
    label: str | None = typer.Option(None, help="Human-readable label."),
    author_username: str | None = typer.Option(None, help="Override inferred author username."),
) -> None:
    """创建一个新的来源配置。"""

    result = create_source(source_type, source_url, label=label, author_username=author_username)
    console.print(result)


@sources_app.command("list")
def source_list_command(
    status: str | None = typer.Option(None, help="Filter by source status."),
    source_type: str | None = typer.Option(None, help="Filter by source type."),
    limit: int = typer.Option(50, help="Maximum sources."),
) -> None:
    """列出来源配置。"""

    rows = list_sources(status=status, source_type=source_type, limit=limit)
    table = Table(title=f"x-media-archiver sources ({len(rows)} result(s))")
    table.add_column("ID", justify="right")
    table.add_column("Type")
    table.add_column("Status")
    table.add_column("Author")
    table.add_column("Discovered", justify="right")
    table.add_column("URL")
    for row in rows:
        table.add_row(
            str(row.get("id")),
            str(row.get("source_type") or ""),
            str(row.get("status") or ""),
            str(row.get("author_username") or ""),
            str(row.get("discovered_tweet_count") or row.get("discovered_count") or 0),
            str(row.get("source_url") or ""),
        )
    console.print(table)


@sources_app.command("submit-urls")
def source_submit_urls_command(
    source_id: int = typer.Argument(..., help="Archive source id."),
    path: Path = typer.Argument(..., help="Path to tweet_urls.txt discovered for this source."),
) -> None:
    """把来源相关 URL 文件导入并提交到下载队列。"""

    records = [{"url": line.strip()} for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]
    result = submit_source_records(source_id, records)
    console.print(result)
    console.print("Queued for processing while `xarchiver serve` is running.")


@sources_app.command("pause")
def source_pause_command(source_id: int = typer.Argument(..., help="Archive source id.")) -> None:
    """暂停指定来源。"""

    console.print(update_source_status(source_id, "paused"))


@sources_app.command("resume")
def source_resume_command(source_id: int = typer.Argument(..., help="Archive source id.")) -> None:
    """恢复指定来源。"""

    console.print(update_source_status(source_id, "active"))


@sources_app.command("scan")
def source_scan_command(
    source_id: int = typer.Argument(..., help="Archive source id."),
    limit: int = typer.Option(20, help="Maximum posts to discover in this scan."),
    restart: bool = typer.Option(False, help="Start again from the latest posts instead of the saved cursor."),
) -> None:
    """立即扫描一次来源，但不自动提交下载。"""

    result = scan_source(source_id, limit, restart=restart)
    console.print(result)
    console.print("Discovered tweets were recorded. Submit them explicitly when you are ready to download.")


@sources_app.command("submit-discovered")
def source_submit_discovered_command(
    source_id: int = typer.Argument(..., help="Archive source id."),
    limit: int | None = typer.Option(None, help="Maximum unsubmitted discovered tweets to queue."),
) -> None:
    """把来源已发现但未提交的推文加入下载队列。"""

    result = submit_discovered_tweets(source_id, limit=limit)
    console.print(result)
    console.print("Queued for processing while `xarchiver serve` is running.")


@sources_app.command("history-start")
def source_history_start_command(
    source_id: int = typer.Argument(..., help="Archive source id."),
    limit: int = typer.Option(20, help="Target tweet window size to scan per batch."),
    restart: bool = typer.Option(False, help="Restart enumeration from the newest range."),
) -> None:
    """启动来源的后台历史扫描。"""

    console.print(start_source_history_scan(source_id, limit, restart=restart))
    console.print("Background discovery started. It records discoveries only and never queues downloads.")


@sources_app.command("history-stop")
def source_history_stop_command(source_id: int = typer.Argument(..., help="Archive source id.")) -> None:
    """停止来源的后台历史扫描。"""

    console.print(stop_source_history_scan(source_id))


@app.command("status")
def status_command() -> None:
    """打印 tweets 和 media_assets 的状态统计。"""

    counts = get_status_counts()
    media_count = get_media_count()

    table = Table(title="x-media-archiver status")
    table.add_column("Status")
    table.add_column("Tweets", justify="right")
    for status, count in sorted(counts.items()):
        table.add_row(status, str(count))
    table.add_row("media_assets", str(media_count))
    console.print(table)


@app.command("search")
def search_command(
    author: str | None = typer.Option(None, help="Filter by author username or display name."),
    text: str | None = typer.Option(None, help="Filter by tweet text."),
    tweet_status: str | None = typer.Option(None, help="Filter by tweet status."),
    media_status: str | None = typer.Option("verified", help="Filter by media status. Use 'all' for every status."),
    media_type: str | None = typer.Option(None, help="Filter by media type, such as photo or video."),
    limit: int = typer.Option(20, help="Maximum results."),
) -> None:
    """按条件搜索媒体记录。"""

    rows = search_media(
        author=author,
        text=text,
        tweet_status=tweet_status,
        media_status=None if media_status == "all" else media_status,
        media_type=media_type,
        limit=limit,
    )
    table = Table(title=f"x-media-archiver search ({len(rows)} result(s))")
    table.add_column("Author")
    table.add_column("Type")
    table.add_column("Status")
    table.add_column("Tweet Text")
    table.add_column("Local Path")
    for row in rows:
        author_label = row.get("author_username") or row.get("author_display_name") or ""
        table.add_row(
            str(author_label),
            str(row.get("media_type") or ""),
            str(row.get("media_status") or ""),
            compact_text(row.get("tweet_text")),
            str(row.get("local_path") or ""),
        )
    console.print(table)


@app.command("duplicates")
def duplicates_command() -> None:
    """打印重复媒体分组摘要。"""

    result = list_duplicates(get_settings())
    rows = result["rows"]
    groups = {row.get("sha256") for row in rows if row.get("sha256")}
    table = Table(title=f"x-media-archiver duplicates ({len(groups)} group(s), {len(rows)} file(s))")
    table.add_column("SHA256")
    table.add_column("Count", justify="right")
    table.add_column("Author")
    table.add_column("Type")
    table.add_column("Local Path")
    for row in rows:
        sha256 = str(row.get("sha256") or "")
        table.add_row(
            sha256[:12],
            str(row.get("duplicate_count") or ""),
            str(row.get("author_username") or ""),
            str(row.get("media_type") or ""),
            str(row.get("local_path") or ""),
        )
    console.print(table)


@app.command("download")
def download_command(
    engine: str | None = typer.Option(None, help="gallery-dl or yt-dlp."),
    limit: int | None = typer.Option(None, help="Maximum tweets to process."),
    dry_run: bool = typer.Option(False, help="Only generate input and job record."),
) -> None:
    """直接执行下载器。"""

    settings = get_settings()
    selected_engine = engine or settings.default_download_engine
    result = run_download(selected_engine, settings, limit, dry_run)
    console.print(result)


@app.command("retry")
def retry_command(
    engine: str | None = typer.Option(None, help="gallery-dl or yt-dlp."),
    limit: int | None = typer.Option(None, help="Maximum tweets to process."),
    dry_run: bool = typer.Option(False, help="Only generate input and job record."),
) -> None:
    """使用下载器重新尝试处理一批推文。"""

    settings = get_settings()
    selected_engine = engine or "yt-dlp"
    result = run_download(selected_engine, settings, limit, dry_run)
    console.print(result)


@app.command("requeue")
def requeue_command(
    status: list[str] | None = typer.Option(
        None,
        "--status",
        help="Tweet status to requeue. Repeat for multiple statuses.",
    ),
    limit: int | None = typer.Option(None, help="Maximum tweets to requeue."),
) -> None:
    """按状态批量重新入队推文。"""

    result = run_requeue(status, limit)
    console.print(result)


@app.command("recover-interrupted")
def recover_interrupted_command(
    timeout_minutes: int | None = typer.Option(
        None,
        help="Mark running/downloading records older than this as failed_retryable.",
    ),
) -> None:
    """恢复因中断而卡住的下载与运行记录。"""

    settings = get_settings()
    result = run_recover_interrupted(settings, timeout_minutes)
    console.print(result)


@app.command("backfill-media")
def backfill_media_command(
    full: bool = typer.Option(False, "--full", help="Confirm a full archive media scan."),
    no_normalize: bool = typer.Option(False, help="Do not move yt-dlp files into the canonical tweet directory."),
) -> None:
    """触发全量媒体回填。"""

    if not full:
        raise typer.BadParameter("This scans the entire archive. Re-run with --full to confirm.")
    settings = get_settings()
    result = run_backfill(settings, normalize_files=not no_normalize)
    console.print(result)


@app.command("verify")
def verify_command(
    limit: int | None = typer.Option(None, help="Maximum media assets to verify."),
    full: bool = typer.Option(False, "--full", help="Confirm full archive file hash verification."),
) -> None:
    """触发媒体文件校验。"""

    if not full:
        raise typer.BadParameter("This reads files across the entire archive. Re-run with --full to confirm.")
    result = run_verify(limit)
    console.print(result)


@app.command("export")
def export_command(
    format: str = typer.Option("csv", help="Export format. Currently only csv is supported."),
    output: Path | None = typer.Option(None, help="Output CSV path."),
    status: str | None = typer.Option("verified", help="Media status to export. Use 'all' to export every status."),
) -> None:
    """导出媒体 CSV。"""

    if format != "csv":
        raise typer.BadParameter("Only csv export is supported in V0.")
    settings = get_settings()
    result = run_export_media(settings, output, None if status == "all" else status)
    console.print(result)


@app.command("export-failures")
def export_failures_command(
    output: Path | None = typer.Option(None, help="Output failures CSV path."),
) -> None:
    """导出失败记录 CSV。"""

    settings = get_settings()
    result = run_export_failures(settings, output)
    console.print(result)


@app.command("export-duplicates")
def export_duplicates_command(
    output: Path | None = typer.Option(None, help="Output duplicate media CSV path."),
) -> None:
    """导出重复媒体 CSV。"""

    settings = get_settings()
    result = run_export_duplicates(settings, output)
    console.print(result)


@app.command("export-gallery")
def export_gallery_command(
    output: Path | None = typer.Option(None, help="Output HTML path."),
    status: str | None = typer.Option(
        "verified", help="Media status to export. Use 'all' to export every status."
    ),
) -> None:
    """导出可离线浏览的 HTML 媒体画廊。"""

    settings = get_settings()
    result = export_media_gallery(settings.archive_dir, output, None if status == "all" else status)
    console.print(result)


@app.command("serve")
def serve_command(
    host: str | None = typer.Option(None, help="API host. Defaults to API_HOST or 127.0.0.1."),
    port: int | None = typer.Option(None, help="API port. Defaults to API_PORT or 18000."),
    reload: bool = typer.Option(False, help="Enable uvicorn reload for local development."),
) -> None:
    """启动本地 FastAPI 服务。"""

    import uvicorn

    settings = get_settings()
    uvicorn.run(
        "xarchiver.api.app:app",
        host=host or settings.api_host,
        port=port or settings.api_port,
        reload=reload,
        workers=1,
    )


if __name__ == "__main__":
    app()
