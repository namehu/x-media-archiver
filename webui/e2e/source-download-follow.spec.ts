import { expect, test, type Page, type Route } from "@playwright/test";

const sourceId = 91;
const runId = 7701;
const tweetIds = Array.from({ length: 10 }, (_, index) => `follow-tweet-${index}`);

test.describe("Source download following", () => {
  test("keeps automatic following monotonic when the worker revisits an older item", async ({ page }) => {
    const fixture = await mockSourceApis(page);
    await openSource(page);

    const toolbar = page.getByTestId("download-follow-controls");
    const toolbarHeightBefore = await elementHeight(toolbar);

    await tweetCard(page, 0).getByRole("button", { name: "下载", exact: true }).click();
    await expect(page.getByText("正在跟随", { exact: true })).toBeVisible();
    await expect(tweetCard(page, 0)).toHaveAttribute("aria-current", "true");

    const scroller = sourceScroller(page);
    await expect(tweetCard(page, 3)).toHaveAttribute("aria-current", "true");
    await expect.poll(() => scrollTop(scroller)).toBeGreaterThan(0);
    const scrollAtThree = await scrollTop(scroller);
    const cardHeightAtThree = await elementHeight(tweetCard(page, 3));
    const progressHeightAtThree = await elementHeight(tweetCard(page, 3).locator("[data-download-progress]"));

    await expect(page.getByTestId("download-current-item")).toContainText(tweetIds[1]);
    await page.waitForTimeout(350);
    expect(await scrollTop(scroller)).toBeGreaterThanOrEqual(scrollAtThree - 1);
    expect(await elementHeight(tweetCard(page, 3).locator("[data-download-progress]"))).toBe(progressHeightAtThree);
    expect(Math.abs((await elementHeight(tweetCard(page, 3))) - cardHeightAtThree)).toBeLessThanOrEqual(1);

    await expect(tweetCard(page, 4)).toHaveAttribute("aria-current", "true");
    await expect.poll(() => scrollTop(scroller)).toBeGreaterThanOrEqual(scrollAtThree - 1);

    expect(await elementHeight(toolbar)).toBe(toolbarHeightBefore);
    expect(fixture.submittedTweetIds).toEqual([tweetIds[0]]);
  });

  test("pauses for reading, resumes at the frontier, and allows explicit backward locating", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockSourceApis(page);
    await openSource(page);

    await tweetCard(page, 0).getByRole("button", { name: "下载", exact: true }).click();
    await expect(page.getByText("正在跟随", { exact: true })).toBeVisible();
    const scroller = sourceScroller(page);
    const pausedAt = await scrollTop(scroller);

    await tweetCard(page, 0).getByRole("button", { name: "展开", exact: true }).click();
    await expect(page.getByText("跟随已暂停", { exact: true })).toBeVisible();
    await expect(page.getByTestId("download-current-item")).toContainText(tweetIds[3]);
    await page.waitForTimeout(350);
    expect(await scrollTop(scroller)).toBeLessThanOrEqual(pausedAt + 1);

    await page.getByRole("button", { name: "继续跟随", exact: true }).click();
    await expect.poll(() => scrollTop(scroller)).toBeGreaterThan(pausedAt + 1);
    await expect(tweetCard(page, 3)).toBeVisible();
    const frontierScrollTop = await scrollTop(scroller);

    await expect(page.getByTestId("download-current-item")).toContainText(tweetIds[1]);
    await page.waitForTimeout(350);
    expect(await scrollTop(scroller)).toBeGreaterThanOrEqual(frontierScrollTop - 1);

    await page.getByRole("button", { name: "定位当前项", exact: true }).click();
    await expect.poll(() => scrollTop(scroller)).toBeLessThan(frontierScrollTop - 1);
    await expect(tweetCard(page, 1)).toHaveAttribute("aria-current", "true");
    await expect(page.getByTestId("download-follow-controls")).toHaveCSS("height", "32px");
  });
});

async function openSource(page: Page) {
  await page.goto("/sources");
  await page.getByText("稳定跟随测试来源", { exact: true }).click();
  await expect(page.getByText("下载工作台", { exact: true })).toBeVisible();
  await expect(tweetCard(page, 0)).toBeVisible();
}

async function mockSourceApis(page: Page) {
  let submittedAt = 0;
  let submittedTweetIds: string[] = [];

  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;

    if (path === "/api/v1/auth/session") {
      return json(route, {
        status: "authenticated",
        auth_mode: "password",
        user: { username: "source-follow-test" },
      });
    }
    if (path === "/api/v1/health/detail") return json(route, healthDetail());
    if (path === "/api/v1/events") {
      return route.fulfill({ status: 200, headers: { "content-type": "text/event-stream" }, body: "" });
    }
    if (path === "/api/v1/settings/download-policy") return json(route, downloadPolicy());
    if (path === "/api/v1/sources" && request.method() === "GET") {
      return json(route, { rows: [sourceBase()], count: 1, total_count: 1, limit: 50, offset: 0 });
    }
    if (path === `/api/v1/sources/${sourceId}`) return json(route, sourceDetail());
    if (path === `/api/v1/sources/${sourceId}/discovered`) {
      const rows = discoveredRows(submittedAt > 0);
      return json(route, { rows, count: rows.length, total_count: rows.length, limit: 50, offset: 0 });
    }
    if (path === `/api/v1/sources/${sourceId}/downloads` && request.method() === "POST") {
      submittedTweetIds = (request.postDataJSON() as { tweet_ids?: string[] }).tweet_ids ?? [];
      submittedAt = Date.now();
      return json(route, {
        run_id: runId,
        source_id: sourceId,
        status: "queued",
        input: { input_record_count: 1, unique_tweet_count: 1, duplicate_input_count: 0 },
        tasks: { queued_count: 1, skipped_verified_count: 0, linked_pending_count: 0 },
      });
    }
    if (path === `/api/v1/sources/${sourceId}/downloads`) {
      return json(route, submittedAt ? downloadSummary(currentIndex(submittedAt)) : emptyDownloadSummary());
    }

    return json(route, {}, 404);
  });

  return {
    get submittedTweetIds() {
      return submittedTweetIds;
    },
  };
}

function currentIndex(submittedAt: number) {
  const elapsed = Date.now() - submittedAt;
  if (elapsed < 1_500) return 0;
  if (elapsed < 4_500) return 3;
  if (elapsed < 7_500) return 1;
  return 4;
}

function sourceBase() {
  return {
    id: sourceId,
    source_type: "profile",
    source_url: "https://x.com/follow_fixture",
    label: "稳定跟随测试来源",
    author_username: "follow_fixture",
    status: "active",
    is_pinned: false,
    discovered_count: tweetIds.length,
    submitted_count: 0,
    discovered_tweet_count: tweetIds.length,
    discovered_media_count: tweetIds.length,
    unsubmitted_tweet_count: tweetIds.length,
    scan_batch_count: 1,
    created_at: "2026-07-19T00:00:00Z",
    updated_at: "2026-07-19T00:00:00Z",
  };
}

function sourceDetail() {
  return {
    ...sourceBase(),
    scan_summary: { batch_count: 1, added_tweet_count: tweetIds.length },
    active_scan_run: null,
    cursor_state: { last_limit: 20 },
  };
}

function discoveredRows(submitted: boolean) {
  return tweetIds.map((tweetId, index) => ({
    id: index + 1,
    tweet_id: tweetId,
    archive_run_id: submitted ? runId : null,
    discovered_at: new Date(Date.UTC(2026, 6, 19, 0, 0, tweetIds.length - index)).toISOString(),
    download_status: "pending",
    author_username: "follow_fixture",
    text: `Tweet ${index} 的长文本用于稳定虚拟列表卡片高度。`.repeat(8),
    raw_payload: { media_count: 1, media_types: ["photo"] },
    downloaded_media_count: 0,
    downloaded_media_bytes: 0,
  }));
}

function downloadSummary(index: number) {
  const items = tweetIds.map((tweetId, itemIndex) => ({
    id: itemIndex + 1,
    tweet_id: tweetId,
    status: itemIndex === index ? "processing" : "pending",
    retry_count: 0,
    cancel_requested: false,
    downloaded_bytes: itemIndex === index ? (index + 1) * 1024 : 0,
    total_bytes: 10 * 1024,
    speed_bps: itemIndex === index ? 2048 : null,
    progress_message:
      itemIndex === index
        ? `当前正在处理 Tweet ${index}，这是一条很长的进度说明，用于确认它不会让卡片高度发生变化。`
        : "等待 worker 认领",
    last_progress_at: "2026-07-19T00:00:00Z",
  }));
  const activeRun = {
    id: runId,
    trigger_type: "source_download",
    source_id: sourceId,
    status: "running",
    started_at: "2026-07-19T00:00:00Z",
    items,
  };
  return {
    source_id: sourceId,
    current_tweet_id: tweetIds[index],
    active_run: activeRun,
    active_counts: {
      total_count: tweetIds.length,
      settled_count: 0,
      pending_count: tweetIds.length - 1,
      blocked_count: 0,
      processing_count: 1,
      failed_retryable_count: 0,
      verified_count: 0,
      skipped_verified_count: 0,
      linked_pending_count: 0,
      failed_permanent_count: 0,
      cancelled_count: 0,
    },
    paused_runs: [],
    blocked_runs: [],
    recent_runs: [activeRun],
    pending_count: tweetIds.length - 1,
    blocked_count: 0,
    processing_count: 1,
    paused_count: 0,
    failed_count: 0,
    completed_count: 0,
    cancelled_count: 0,
    downloaded_bytes: (index + 1) * 1024,
    total_bytes: tweetIds.length * 10 * 1024,
    speed_bps: 2048,
  };
}

function emptyDownloadSummary() {
  return {
    source_id: sourceId,
    current_tweet_id: null,
    active_run: null,
    active_counts: {
      total_count: 0,
      settled_count: 0,
      pending_count: 0,
      blocked_count: 0,
      processing_count: 0,
      failed_retryable_count: 0,
      verified_count: 0,
      skipped_verified_count: 0,
      linked_pending_count: 0,
      failed_permanent_count: 0,
      cancelled_count: 0,
    },
    paused_runs: [],
    blocked_runs: [],
    recent_runs: [],
    pending_count: 0,
    blocked_count: 0,
    processing_count: 0,
    paused_count: 0,
    failed_count: 0,
    completed_count: 0,
    cancelled_count: 0,
    downloaded_bytes: 0,
    total_bytes: 0,
    speed_bps: 0,
  };
}

function healthDetail() {
  return {
    status: "ok",
    worker: { stop_requested: false, write_lock_held: false },
    db_pool: { active: 0, idle: 1, waiting: 0, min_size: 1, max_size: 5 },
    queue: {
      pending_items: 0,
      processing_items: 0,
      retryable_failed_items: 0,
      permanent_failed_items: 0,
      queued_runs: 0,
      running_runs: 0,
    },
    sources: {
      active_sources: 1,
      paused_sources: 0,
      failed_sources: 0,
      history_enabled_sources: 0,
      active_scan_runs: 0,
    },
    recent_errors: [],
  };
}

function downloadPolicy() {
  return {
    queue_batch_size: 10,
    downloader_sleep_min_seconds: 0,
    downloader_sleep_max_seconds: 0,
    downloader_progress_fallback_interval_seconds: 1,
    default_download_engine: "gallery-dl",
    source_scan_batch_size: 20,
    source_scan_sleep_min_seconds: 0,
    source_scan_sleep_max_seconds: 0,
    source_scan_http_timeout_seconds: 30,
    source_scan_http_retries: 1,
  };
}

function tweetCard(page: Page, index: number) {
  return page.locator(`[data-tweet-id="${tweetIds[index]}"]`);
}

function sourceScroller(page: Page) {
  return page.locator('[data-virtuoso-scroller="true"]').last();
}

async function scrollTop(scroller: ReturnType<Page["locator"]>) {
  return scroller.evaluate((element) => element.scrollTop);
}

async function elementHeight(locator: ReturnType<Page["locator"]>) {
  return locator.evaluate((element) => element.getBoundingClientRect().height);
}

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, json: body });
}
