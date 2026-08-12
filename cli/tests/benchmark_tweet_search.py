"""Measure Tweet search latency against a pre-populated synthetic database."""

from __future__ import annotations

import statistics
import time

from xarchiver.search import search_tweet_library

RUNS = 20


def measure(name: str, **filters: object) -> None:
    """Warm a search case and report median, p95, maximum and result count."""

    for _ in range(3):
        search_tweet_library(limit=20, offset=0, **filters)

    durations: list[float] = []
    total_count = 0
    for _ in range(RUNS):
        started_at = time.perf_counter()
        *_, total_count = search_tweet_library(limit=20, offset=0, **filters)
        durations.append((time.perf_counter() - started_at) * 1000)

    sorted_durations = sorted(durations)
    p95_index = max(0, round(RUNS * 0.95) - 1)
    print(
        f"{name}: runs={RUNS} median_ms={statistics.median(durations):.2f} "
        f"p95_ms={sorted_durations[p95_index]:.2f} max_ms={max(durations):.2f} "
        f"matches={total_count}"
    )


if __name__ == "__main__":
    measure("english", query="orbital mechanics", tweet_status="all")
    measure("chinese", query="量子纠缠", tweet_status="all")
    measure("fuzzy", query="orbital mechanix", tweet_status="all")
    measure("browse", query=None, tweet_status="verified")
