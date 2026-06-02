import base64
import sys
from pathlib import Path

from psycopg.types.json import Jsonb

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from xarchiver.config import get_settings
from xarchiver.db import connect

TWEET_IDS = ["webui-e2e-verified", "webui-e2e-failed"]
SOURCE_URL = "https://x.com/webui_e2e/media"


def main() -> None:
    media_path = ensure_fixture_media()
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute("delete from download_attempts where tweet_id = any(%s)", (TWEET_IDS,))
            cur.execute(
                """
                delete from download_jobs
                where archive_run_id in (
                  select id from archive_runs where trigger_type = 'webui_e2e'
                )
                """
            )
            cur.execute("delete from source_discovered_tweets where tweet_id = any(%s)", (TWEET_IDS,))
            cur.execute("delete from media_assets where tweet_id = any(%s)", (TWEET_IDS,))
            cur.execute("delete from archive_run_items where tweet_id = any(%s)", (TWEET_IDS,))
            cur.execute("delete from archive_runs where trigger_type = 'webui_e2e'")
            cur.execute("delete from tweets where tweet_id = any(%s)", (TWEET_IDS,))
            cur.execute("delete from archive_sources where source_url = %s", (SOURCE_URL,))

            cur.execute(
                """
                insert into archive_sources (
                  source_type, source_url, label, author_username, status,
                  cursor_state, discovered_count, submitted_count
                )
                values (
                  'user_media', %s, 'webui-e2e source', 'webui_e2e', 'active',
                  %s, 2, 2
                )
                returning id
                """,
                (
                    SOURCE_URL,
                    Jsonb({"next_start_index": 2, "automation_enabled": False}),
                ),
            )
            source_id = cur.fetchone()["id"]

            cur.execute(
                """
                insert into tweets (
                  tweet_id, url, author_username, author_display_name, published_at,
                  text, source_type, source_url, download_status, raw_import,
                  last_error, retry_count
                )
                values
                  (
                    'webui-e2e-verified',
                    'https://x.com/webui_e2e/status/webui-e2e-verified',
                    'webui_e2e',
                    'WebUI E2E',
                    now() - interval '1 day',
                    'webui-e2e fixture tweet with a verified media row',
                    'user_media',
                    %s,
                    'verified',
                    %s,
                    null,
                    0
                  ),
                  (
                    'webui-e2e-failed',
                    'https://x.com/webui_e2e/status/webui-e2e-failed',
                    'webui_e2e',
                    'WebUI E2E',
                    now() - interval '2 days',
                    'webui-e2e failed tweet for failure page smoke test',
                    'user_media',
                    %s,
                    'failed_retryable',
                    %s,
                    'webui-e2e fixture error',
                    1
                  )
                """,
                (
                    SOURCE_URL,
                    Jsonb({"fixture": "webui-e2e"}),
                    SOURCE_URL,
                    Jsonb({"fixture": "webui-e2e"}),
                ),
            )

            cur.execute(
                """
                insert into media_assets (
                  tweet_id, media_index, media_type, local_path, original_filename,
                  file_ext, file_size, sha256, width, height, source_engine,
                  download_status, raw_metadata
                )
                values (
                  'webui-e2e-verified', 1, 'photo', %s, 'webui-e2e.png',
                  'png', %s, 'webui-e2e-sha256', 1, 1, 'fixture',
                  'verified', %s
                )
                """,
                (str(media_path), media_path.stat().st_size, Jsonb({"fixture": "webui-e2e"})),
            )

            cur.execute(
                """
                insert into archive_runs (
                  trigger_type, input_path, status, started_at, finished_at, result
                )
                values (
                  'webui_e2e', 'webui-e2e fixture', 'completed_with_failures',
                  now() - interval '10 minutes', now() - interval '9 minutes',
                  %s
                )
                returning id
                """,
                (
                    Jsonb(
                        {
                            "pipeline_version": "webui-e2e",
                            "tasks": {
                                "queued_count": 2,
                                "skipped_verified_count": 0,
                                "linked_pending_count": 0,
                                "verified_count": 1,
                                "failed_count": 1,
                            },
                        }
                    ),
                ),
            )
            run_id = cur.fetchone()["id"]

            cur.execute(
                """
                insert into archive_run_items (
                  archive_run_id, tweet_id, input_payload, status, retry_count,
                  last_attempt_at, error_category, error_message
                )
                values
                  (%s, 'webui-e2e-verified', %s, 'verified', 0, now() - interval '9 minutes', null, null),
                  (%s, 'webui-e2e-failed', %s, 'failed_retryable', 1, now() - interval '8 minutes', 'network_error', 'webui-e2e fixture error')
                returning id, tweet_id
                """,
                (
                    run_id,
                    Jsonb({"url": "https://x.com/webui_e2e/status/webui-e2e-verified"}),
                    run_id,
                    Jsonb({"url": "https://x.com/webui_e2e/status/webui-e2e-failed"}),
                ),
            )
            item_ids = {row["tweet_id"]: row["id"] for row in cur.fetchall()}

            cur.execute(
                """
                insert into download_jobs (
                  job_type, engine, status, total_count, success_count, failed_count,
                  started_at, finished_at, archive_run_id
                )
                values (
                  'archive_run', 'fixture', 'completed_with_failures', 2, 1, 1,
                  now() - interval '10 minutes', now() - interval '8 minutes', %s
                )
                returning id
                """,
                (run_id,),
            )
            job_id = cur.fetchone()["id"]

            cur.execute(
                """
                insert into download_attempts (
                  job_id, tweet_id, archive_run_item_id, engine, status, exit_code,
                  error_category, error_message, started_at, finished_at
                )
                values
                  (%s, 'webui-e2e-verified', %s, 'fixture', 'succeeded', 0, null, null, now() - interval '9 minutes', now() - interval '9 minutes'),
                  (%s, 'webui-e2e-failed', %s, 'fixture', 'failed', 1, 'network_error', 'webui-e2e fixture error', now() - interval '8 minutes', now() - interval '8 minutes')
                """,
                (job_id, item_ids["webui-e2e-verified"], job_id, item_ids["webui-e2e-failed"]),
            )

            cur.execute(
                """
                insert into source_discovered_tweets (
                  source_id, tweet_id, archive_run_id, raw_payload
                )
                values
                  (%s, 'webui-e2e-verified', %s, %s),
                  (%s, 'webui-e2e-failed', %s, %s)
                """,
                (
                    source_id,
                    run_id,
                    Jsonb({"media_count": 1, "media_types": ["photo"], "has_photo": True}),
                    source_id,
                    run_id,
                    Jsonb({"media_count": 0, "media_types": []}),
                ),
            )
        conn.commit()


def ensure_fixture_media() -> Path:
    archive_dir = Path(get_settings().archive_dir)
    media_dir = archive_dir / "media" / "webui_e2e" / "webui-e2e-verified"
    media_dir.mkdir(parents=True, exist_ok=True)
    media_path = media_dir / "webui-e2e.png"
    if not media_path.exists():
        media_path.write_bytes(
            base64.b64decode(
                "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMB/axXf7sAAAAASUVORK5CYII="
            )
        )
    return media_path


if __name__ == "__main__":
    main()
