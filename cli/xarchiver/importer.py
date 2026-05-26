from __future__ import annotations

from pathlib import Path
from typing import Any

import orjson
from psycopg.types.json import Jsonb

from xarchiver.db import connect


def import_urls(path: Path, source_type: str = "url_list", source_url: str | None = None) -> int:
    rows = []
    for line in path.read_text(encoding="utf-8").splitlines():
        url = line.strip()
        if not url or url.startswith("#"):
            continue
        tweet_id = extract_tweet_id(url)
        rows.append(
            {
                "tweet_id": tweet_id,
                "url": url,
                "author_username": None,
                "author_display_name": None,
                "published_at": None,
                "text": None,
                "source_type": source_type,
                "source_url": source_url,
                "collected_at": None,
                "raw_import": {"url": url},
            }
        )
    upsert_tweets(rows)
    return len(rows)


def import_jsonl(path: Path) -> int:
    rows: list[dict[str, Any]] = []
    for index, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        line = line.strip()
        if not line:
            continue
        try:
            data = orjson.loads(line)
        except orjson.JSONDecodeError as exc:
            raise ValueError(f"Invalid JSONL at line {index}: {exc}") from exc

        tweet_id = str(data.get("tweet_id") or extract_tweet_id(str(data.get("url", ""))))
        rows.append(
            {
                "tweet_id": tweet_id,
                "url": str(data["url"]),
                "author_username": data.get("author_username"),
                "author_display_name": data.get("author_display_name"),
                "published_at": data.get("datetime") or data.get("published_at"),
                "text": data.get("text"),
                "source_type": data.get("source_type"),
                "source_url": data.get("source_url"),
                "collected_at": data.get("collected_at"),
                "raw_import": data,
            }
        )
    upsert_tweets(rows)
    return len(rows)


def upsert_tweets(rows: list[dict[str, Any]]) -> None:
    if not rows:
        return

    sql = """
        insert into tweets (
            tweet_id,
            url,
            author_username,
            author_display_name,
            published_at,
            text,
            source_type,
            source_url,
            collected_at,
            raw_import
        )
        values (
            %(tweet_id)s,
            %(url)s,
            %(author_username)s,
            %(author_display_name)s,
            %(published_at)s,
            %(text)s,
            %(source_type)s,
            %(source_url)s,
            %(collected_at)s,
            %(raw_import)s
        )
        on conflict (tweet_id) do update set
            url = excluded.url,
            author_username = coalesce(excluded.author_username, tweets.author_username),
            author_display_name = coalesce(excluded.author_display_name, tweets.author_display_name),
            published_at = coalesce(excluded.published_at, tweets.published_at),
            text = coalesce(excluded.text, tweets.text),
            source_type = coalesce(excluded.source_type, tweets.source_type),
            source_url = coalesce(excluded.source_url, tweets.source_url),
            collected_at = coalesce(excluded.collected_at, tweets.collected_at),
            raw_import = excluded.raw_import,
            updated_at = now()
    """

    with connect() as conn:
        with conn.cursor() as cur:
            for row in rows:
                row = {**row, "raw_import": Jsonb(row["raw_import"])}
                cur.execute(sql, row)
        conn.commit()


def extract_tweet_id(url: str) -> str:
    parts = [part for part in url.replace("?", "/?").split("/") if part]
    for index, part in enumerate(parts):
        if part == "status" and index + 1 < len(parts):
            tweet_id = parts[index + 1].split("?")[0]
            if tweet_id.isdigit():
                return tweet_id
    raise ValueError(f"Could not extract tweet id from URL: {url}")
