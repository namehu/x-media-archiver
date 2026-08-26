import { expect, test, type Page, type Route } from "@playwright/test";

test("collections uses a catalog-to-detail flow and keeps collection settings in a sheet", async ({ page }) => {
  await mockCollectionsApis(page);

  await page.goto("/collections");

  await expect(page.getByRole("heading", { name: "合集", exact: true })).toBeVisible();
  await expect(page.getByText("1 个合集")).toBeVisible();
  await expect(page.getByRole("heading", { name: "研究资料" })).toBeVisible();
  await expect(page.getByText("合集设置")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await page.getByRole("button", { name: "打开合集 研究资料" }).click();
  await expect(page).toHaveURL(/collection=2/);
  await expect(page.getByText("一条用于验证合集详情的 Tweet。", { exact: true })).toBeVisible();

  await page.evaluate(() => localStorage.setItem("x-archiver-theme", "dark"));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect(page.getByText("一条用于验证合集详情的 Tweet。", { exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await page.getByRole("button", { name: "合集设置" }).click();
  const settingsSheet = page.getByRole("dialog", { name: "合集设置" });
  await expect(settingsSheet).toBeVisible();
  await expect(settingsSheet.getByLabel("合集封面")).toBeVisible();
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "返回全部合集" }).click();
  await expect(page).not.toHaveURL(/collection=/);
  await expect(page.getByRole("button", { name: "标签管理" })).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

async function mockCollectionsApis(page: Page) {
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());

    if (url.pathname === "/api/v1/auth/session") {
      return json(route, {
        status: "authenticated",
        auth_mode: "password",
        user: { username: "collections-test" },
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
          active_sources: 1,
          paused_sources: 0,
          failed_sources: 0,
          history_enabled_sources: 0,
          active_scan_runs: 0,
        },
        recent_errors: [],
      });
    }
    if (url.pathname === "/api/v1/runtime/snapshot") return json(route, runtimeSnapshot());
    if (url.pathname === "/api/v1/library/organization" && request.method() === "GET") {
      return json(route, {
        tags: [{ id: 1, name: "重点", normalized_name: "重点", color: "#3366ff", tweet_count: 1 }],
        collections: [collectionFixture()],
      });
    }
    if (url.pathname === "/api/v1/library/organization/collections/2/tweets" && request.method() === "GET") {
      return json(route, {
        collection: collectionFixture(),
        rows: [tweetFixture()],
        count: 1,
        total_count: 1,
        limit: 20,
        offset: 0,
      });
    }
    if (url.pathname === "/api/v1/events") {
      return route.fulfill({ status: 200, headers: { "content-type": "text/event-stream" }, body: "" });
    }
    if (url.pathname.startsWith("/api/v1/media-file/")) return route.fulfill({ status: 404 });
    return json(route, {}, 404);
  });
}

function collectionFixture() {
  return {
    id: 2,
    name: "研究资料",
    normalized_name: "研究资料",
    description: "持续整理值得回看的媒体内容。",
    cover_media_id: 11,
    cover: {
      id: 11,
      media_type: "photo",
      media_url: "data:image/gif;base64,R0lGODlhAQABAAAAACw=",
    },
    tweet_count: 1,
  };
}

function tweetFixture() {
  return {
    tweet_id: "collection-fixture",
    tweet_url: "https://x.com/example/status/collection-fixture",
    author_username: "example",
    author_display_name: "示例作者",
    published_at: "2026-01-01T00:00:00Z",
    tweet_text: "一条用于验证合集详情的 Tweet。",
    tweet_status: "verified",
    hashtags: [],
    tags: ["重点"],
    collections: ["研究资料"],
    collection_count: 1,
    has_note: true,
    note_excerpt: "私人备注",
    relevance: 1,
    media: [
      {
        id: 11,
        tweet_id: "collection-fixture",
        media_index: 0,
        media_type: "photo",
        media_status: "verified",
        media_relative_path: "media/example/collection-fixture/0.jpg",
        media_url: "data:image/gif;base64,R0lGODlhAQABAAAAACw=",
        preview_url: "data:image/gif;base64,R0lGODlhAQABAAAAACw=",
      },
    ],
  };
}

function runtimeSnapshot() {
  return {
    epoch: "collections-e2e",
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
      active_sources: 1,
      paused_sources: 0,
      failed_sources: 0,
      history_enabled_sources: 0,
      active_scan_runs: 0,
    },
    global: { active_run_count: 0, active_item_count: 0, active_scan_count: 0, downloaded_bytes: 0 },
    runs: [],
    items: [],
    scans: [],
    recent_activity: [],
  };
}

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}
