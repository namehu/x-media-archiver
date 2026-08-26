import { expect, test, type Page, type Route } from "@playwright/test";

test("insights renders database facts, stays read-only, and redacts author identity", async ({ page }) => {
  const apiRequests: Array<{ method: string; path: string }> = [];
  await mockInsightsApis(page, apiRequests);

  await page.goto("/insights?debugger=1");

  await expect(page.getByRole("heading", { name: "归档洞察" })).toBeVisible();
  await expect(page.getByText("内容发布时间趋势")).toBeVisible();
  await expect(page.getByText("归档入库趋势")).toBeVisible();
  await expect(page.getByText("来源发现状态")).toBeVisible();
  await expect(page.getByText("不是下载活动趋势")).toBeVisible();
  await expect(page.locator(".recharts-responsive-container")).toHaveCount(2);
  await expect(page.locator(".recharts-pie")).toHaveCount(0);
  await expect(page.getByText("图片", { exact: true })).toBeVisible();

  const authorBody = page.locator("tbody[data-debug-redact]").filter({ hasText: "private-author" });
  await expect(authorBody).toHaveCount(1);
  await expect(authorBody).not.toHaveCSS("filter", "none");

  await page.evaluate(() => localStorage.setItem("x-archiver-theme", "dark"));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect(page.getByText("元数据完整率")).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(apiRequests.filter((request) => request.method !== "GET")).toEqual([]);
});

test("insights exposes an API error and can retry", async ({ page }) => {
  let insightsAttempts = 0;
  await mockInsightsApis(page, [], () => {
    insightsAttempts += 1;
    return insightsAttempts === 1 ? null : insightsFixture();
  });

  await page.goto("/insights");
  await expect(page.getByText("归档洞察暂不可用")).toBeVisible();
  await page.getByRole("button", { name: "重试" }).click();
  await expect(page.getByRole("heading", { name: "归档洞察" })).toBeVisible();
  expect(insightsAttempts).toBe(2);
});

test("insights explains an empty database without rendering charts", async ({ page }) => {
  await mockInsightsApis(page, [], emptyInsightsFixture);

  await page.goto("/insights");
  await expect(page.getByRole("heading", { name: "归档洞察" })).toBeVisible();
  await expect(page.getByText("还没有可分析的归档数据")).toBeVisible();
  await expect(page.locator(".recharts-responsive-container")).toHaveCount(0);
});

async function mockInsightsApis(
  page: Page,
  requests: Array<{ method: string; path: string }>,
  resolveInsights: () => ReturnType<typeof insightsFixture> | null = insightsFixture,
) {
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    requests.push({ method: request.method(), path: url.pathname });

    if (url.pathname === "/api/v1/auth/session") {
      return json(route, {
        status: "authenticated",
        auth_mode: "password",
        user: { username: "insights-test" },
      });
    }
    if (url.pathname === "/api/v1/health/detail") {
      return json(route, {
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
          active_sources: 2,
          paused_sources: 0,
          failed_sources: 0,
          history_enabled_sources: 0,
          active_scan_runs: 0,
        },
        recent_errors: [],
      });
    }
    if (url.pathname === "/api/v1/library/insights") {
      const result = resolveInsights();
      return result ? json(route, result) : json(route, { detail: "temporary failure" }, 500);
    }
    if (url.pathname === "/api/v1/runtime/snapshot") {
      return json(route, runtimeSnapshot());
    }
    return json(route, {}, 404);
  });
}

function insightsFixture() {
  return {
    overview: {
      tweet_count: 3,
      media_count: 3,
      known_media_bytes: 500,
      known_video_duration_ms: 60000,
      author_count: 1,
      source_count: 2,
    },
    media_types: [
      { key: "photo", count: 2, known_bytes: 100 },
      { key: "video", count: 1, known_bytes: 400 },
    ],
    media_statuses: [
      { key: "verified", count: 2, known_bytes: 500 },
      { key: "missing", count: 1, known_bytes: 0 },
    ],
    published_months: [
      { month: "2026-01-01T00:00:00Z", count: 2, media_count: 2, known_bytes: 500 },
      { month: "2026-02-01T00:00:00Z", count: 1, media_count: 1, known_bytes: 0 },
    ],
    imported_months: [
      { month: "2026-03-01T00:00:00Z", count: 2 },
      { month: "2026-04-01T00:00:00Z", count: 1 },
    ],
    top_authors: [
      { author_username: "private-author", tweet_count: 2, media_count: 2, known_bytes: 500 },
    ],
    organization: {
      total_count: 3,
      tagged_count: 1,
      collected_count: 1,
      noted_count: 1,
      organized_count: 2,
    },
    completeness: {
      tweet_count: 3,
      published_at_count: 3,
      author_count: 2,
      text_count: 2,
      media_count: 3,
      media_file_size_count: 2,
      media_sha256_count: 1,
      media_dimensions_count: 2,
      video_count: 1,
      video_duration_count: 1,
    },
    discovery: { discovered_count: 2, submitted_count: 0, verified_count: 2 },
  };
}

function emptyInsightsFixture() {
  return {
    overview: {
      tweet_count: 0,
      media_count: 0,
      known_media_bytes: 0,
      known_video_duration_ms: 0,
      author_count: 0,
      source_count: 0,
    },
    media_types: [],
    media_statuses: [],
    published_months: [],
    imported_months: [],
    top_authors: [],
    organization: {
      total_count: 0,
      tagged_count: 0,
      collected_count: 0,
      noted_count: 0,
      organized_count: 0,
    },
    completeness: {
      tweet_count: 0,
      published_at_count: 0,
      author_count: 0,
      text_count: 0,
      media_count: 0,
      media_file_size_count: 0,
      media_sha256_count: 0,
      media_dimensions_count: 0,
      video_count: 0,
      video_duration_count: 0,
    },
    discovery: { discovered_count: 0, submitted_count: 0, verified_count: 0 },
  };
}

function runtimeSnapshot() {
  return {
    epoch: "insights-e2e",
    sequence: 0,
    recent_window_seconds: 120,
    worker: { stop_requested: false, write_lock_held: false },
    queue: {
      pending_items: 0,
      processing_items: 0,
      retryable_failed_items: 0,
      permanent_failed_items: 0,
      queued_runs: 0,
      running_runs: 0,
    },
    sources: {
      active_sources: 2,
      paused_sources: 0,
      failed_sources: 0,
      history_enabled_sources: 0,
      active_scan_runs: 0,
    },
    global: {
      active_run_count: 0,
      active_item_count: 0,
      active_scan_count: 0,
      downloaded_bytes: 0,
    },
    runs: [],
    items: [],
    scans: [],
    recent_activity: [],
  };
}

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}
