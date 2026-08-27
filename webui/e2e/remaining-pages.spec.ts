import { expect, test, type Page, type Route } from "@playwright/test";

test("remaining management pages share the compact workspace language", async ({ page }) => {
  await mockRemainingPageApis(page);

  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "系统概览" })).toBeVisible();
  await expect(page.getByText("状态数量与占比")).toBeVisible();
  await expect(page.locator(".recharts-pie")).toHaveCount(0);

  await page.goto("/queue");
  await expect(page.getByRole("heading", { name: "归档队列" })).toBeVisible();
  await expect(page.getByText("批次正在处理")).toBeVisible();
  await expect(page.locator("[class*='bg-gradient']")).toHaveCount(0);
  await expect.poll(() => page.getByText("实时事件已连接").count()).toBeLessThanOrEqual(1);

  await page.goto("/failures");
  await expect(page.getByRole("heading", { name: "失败工作台" })).toBeVisible();
  await expect(page.getByText("网络错误", { exact: true }).first()).toBeVisible();

  await page.goto("/duplicates");
  await expect(page.getByRole("heading", { name: "重复媒体" })).toBeVisible();
  await expect(page.getByText("SHA-256 完全一致")).toBeVisible();
  await expect(page.getByRole("button", { name: "保留一项，选择其余" })).toBeVisible();

  await page.goto("/operations");
  await expect(page.getByRole("heading", { name: "系统操作" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "维护操作" })).toBeVisible();
  await expect(page.getByText("还没有执行操作。")).toHaveCount(0);
  await page.getByRole("tab", { name: "系统状态" }).click();
  await expect(page.getByText("实时通道诊断")).toBeVisible();
});

test("remaining pages stay usable on a narrow dark viewport", async ({ page }) => {
  await mockRemainingPageApis(page);
  await page.addInitScript(() => localStorage.setItem("x-archiver-theme", "dark"));
  await page.setViewportSize({ width: 390, height: 844 });

  const loadedCopy: Record<string, string> = {
    "/dashboard": "归档状态分布",
    "/queue": "Run #41",
    "/failures": "待处理失败",
    "/duplicates": "SHA-256 完全一致",
    "/operations": "维护操作",
  };
  for (const path of Object.keys(loadedCopy)) {
    await page.goto(path);
    await expect(page.locator("html")).toHaveClass(/dark/);
    await expect(page.getByText(loadedCopy[path], { exact: true }).first()).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
});

test("tweet detail uses a content stream with a contextual management column", async ({ page }) => {
  await mockRemainingPageApis(page);

  await page.goto("/tweets/remaining-page-tweet");
  await expect(page.getByRole("heading", { name: "Tweet", exact: true, level: 1 })).toBeVisible();
  await expect(page.getByText("一条用于检查详情布局的归档内容。")).toBeVisible();
  await expect(page.getByText("为当前 Tweet 分配标签、合集和私人备注")).toBeVisible();
  await expect(page.getByRole("button", { name: "返回上一页" })).toBeVisible();
  await expect(page.locator("main > article")).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(page.getByText("整理信息")).toBeVisible();
});

async function mockRemainingPageApis(page: Page) {
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());

    if (url.pathname === "/api/v1/auth/session") {
      return json(route, {
        status: "authenticated",
        auth_mode: "password",
        user: { username: "remaining-pages-test" },
      });
    }
    if (url.pathname === "/api/v1/health/detail") return json(route, healthFixture());
    if (url.pathname === "/api/v1/runtime/snapshot") return json(route, runtimeSnapshot());
    if (url.pathname === "/api/v1/runtime/diagnostics") return json(route, runtimeDiagnostics());
    if (url.pathname === "/api/v1/library/summary") return json(route, summaryFixture());
    if (url.pathname === "/api/v1/archive-runs/41") return json(route, archiveRunDetail());
    if (url.pathname === "/api/v1/archive-runs" && request.method() === "GET") {
      return json(route, { rows: [archiveRun()], count: 1, total_count: 1, limit: 50, offset: 0 });
    }
    if (url.pathname === "/api/v1/library/failures") return json(route, failuresFixture());
    if (url.pathname === "/api/v1/library/duplicates") return json(route, duplicatesFixture());
    if (url.pathname === "/api/v1/library/tweets/remaining-page-tweet") return json(route, tweetDetailFixture());
    if (url.pathname.startsWith("/api/v1/media-file/")) return mediaSvg(route);
    return json(route, {}, 404);
  });
}

function summaryFixture() {
  return {
    tweet_status_counts: { verified: 128, pending: 9, failed_retryable: 4 },
    media_count: 286,
    failure_count: 4,
    archive_dir: "/archive/media",
    exports: [
      { name: "media-2026-08.csv", path: "/archive/exports/media-2026-08.csv", size: 12800, modified_at: 1787673600 },
    ],
  };
}

function archiveRun() {
  return {
    id: 41,
    trigger_type: "webui",
    status: "running",
    started_at: "2026-08-26T08:30:00Z",
    result: {
      tasks: {
        queued_count: 2,
        skipped_verified_count: 1,
        linked_pending_count: 0,
        verified_count: 5,
        failed_count: 1,
        processing_count: 1,
      },
    },
  };
}

function archiveRunDetail() {
  return {
    ...archiveRun(),
    items: [
      {
        id: 101,
        tweet_id: "remaining-page-tweet",
        status: "processing",
        retry_count: 0,
        downloaded_bytes: 1024,
        total_bytes: 4096,
        progress_message: "正在下载媒体",
        attempts: [],
      },
      {
        id: 102,
        tweet_id: "failed-tweet",
        status: "failed_retryable",
        retry_count: 2,
        error_category: "network_error",
        error_message: "上游连接超时",
        attempts: [],
      },
    ],
  };
}

function failuresFixture() {
  const rows = [
    {
      tweet_id: "failed-tweet",
      author_username: "archive-user",
      tweet_status: "failed_retryable",
      retry_count: 2,
      latest_engine: "gallery-dl",
      latest_error_category: "network_error",
      latest_error_message: "上游连接超时",
      failure_at: "2026-08-26T08:00:00Z",
      disposition: "open",
    },
  ];
  return {
    rows,
    count: 1,
    total_count: 1,
    limit: 100,
    offset: 0,
    aggregates: {
      total_count: 1,
      open_count: 1,
      ignored_count: 0,
      retryable_count: 1,
      permanent_count: 0,
      corrupt_count: 0,
      retry_total: 2,
    },
    disposition_counts: {
      total_count: 1,
      open_count: 1,
      ignored_count: 0,
      retryable_count: 1,
      permanent_count: 0,
      corrupt_count: 0,
      retry_total: 2,
    },
    error_categories: [{ error_category: "network_error", count: 1 }],
  };
}

function duplicatesFixture() {
  const rows = [1, 2, 3].map((id) => ({
    id,
    tweet_id: `duplicate-${id}`,
    tweet_url: `https://x.com/archive/status/duplicate-${id}`,
    author_username: "archive-user",
    tweet_text: `重复媒体 ${id}`,
    media_index: 0,
    media_type: "photo",
    media_status: "verified",
    local_path: `/archive/media/archive-user/duplicate-${id}/0.jpg`,
    media_url: `/api/v1/media-file/media/archive-user/duplicate-${id}/0.jpg`,
    file_size: 2048,
  }));
  return {
    groups: [
      {
        sha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        duplicate_count: 3,
        total_size: 6144,
        rows,
      },
    ],
    count: 1,
    total_count: 1,
    limit: 20,
    offset: 0,
    duplicate_groups: 1,
    total_media_count: 286,
  };
}

function tweetDetailFixture() {
  const media = [1, 2].map((id, index) => ({
    id,
    tweet_id: "remaining-page-tweet",
    media_index: index,
    media_type: "photo",
    media_status: "verified",
    local_path: `/archive/media/archive-user/remaining-page-tweet/${index}.jpg`,
    media_url: `/api/v1/media-file/media/archive-user/remaining-page-tweet/${index}.jpg`,
    file_size: 4096,
    width: 1200,
    height: 800,
  }));
  return {
    tweet: {
      id: 99,
      tweet_id: "remaining-page-tweet",
      tweet_url: "https://x.com/archive/status/remaining-page-tweet",
      author_username: "archive-user",
      author_display_name: "归档作者",
      published_at: "2026-08-25T10:00:00Z",
      updated_at: "2026-08-26T10:00:00Z",
      tweet_text: "一条用于检查详情布局的归档内容。",
      tweet_status: "verified",
      retry_count: 1,
    },
    hashtags: ["archive", "media"],
    media,
    attempts: [
      {
        id: 1,
        job_id: 51,
        engine: "gallery-dl",
        status: "completed",
        finished_at: "2026-08-26T09:00:00Z",
      },
    ],
    organization: {
      tweet_id: "remaining-page-tweet",
      tags: [{ id: 1, name: "重点", normalized_name: "重点", tweet_count: 1 }],
      collections: [{ id: 2, name: "研究资料", normalized_name: "研究资料", tweet_count: 1 }],
      note: { content: "保留用于设计回归。", created_at: "2026-08-26T09:00:00Z", updated_at: "2026-08-26T09:00:00Z" },
    },
  };
}

function healthFixture() {
  return {
    status: "ok",
    worker: { stop_requested: false, write_lock_held: false },
    db_pool: { active: 1, idle: 2, waiting: 0, min_size: 1, max_size: 5 },
    queue: {
      pending_items: 2,
      processing_items: 1,
      retryable_failed_items: 1,
      permanent_failed_items: 0,
      queued_runs: 0,
      running_runs: 1,
      latest_run: archiveRun(),
    },
    sources: {
      active_sources: 2,
      paused_sources: 0,
      failed_sources: 0,
      history_enabled_sources: 1,
      active_scan_runs: 0,
    },
    recent_errors: [],
  };
}

function runtimeSnapshot() {
  const health = healthFixture();
  return {
    epoch: "remaining-pages-e2e",
    sequence: 1,
    recent_window_seconds: 120,
    worker: health.worker,
    queue: health.queue,
    sources: health.sources,
    global: { active_run_count: 1, active_item_count: 1, active_scan_count: 0, downloaded_bytes: 1024 },
    runs: [],
    items: [],
    scans: [],
    recent_activity: [],
  };
}

function runtimeDiagnostics() {
  return {
    broker: {
      epoch: "remaining-pages-e2e",
      sequence: 1,
      published_events: 12,
      published_by_type: {},
      sse_connections: 0,
      ws_connections: 1,
      queue_high_water: 2,
      dropped_events: 0,
    },
    websocket: {
      active_connections: 1,
      accepted_connections: 1,
      messages_sent: 12,
      bytes_sent: 4096,
      snapshots_sent: 1,
      patches_sent: 10,
      invalidations_sent: 1,
      heartbeats_sent: 0,
      resyncs_sent: 0,
      queue_overflows: 0,
      dropped_events: 0,
      auth_rejections: 0,
      origin_rejections: 0,
      send_errors: 0,
    },
  };
}

function mediaSvg(route: Route) {
  return route.fulfill({
    status: 200,
    contentType: "image/svg+xml",
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"><rect width="1200" height="800" fill="#dcecf8"/><circle cx="930" cy="180" r="220" fill="#8ecbf2"/><path d="M0 690 340 360 590 610 760 470 1200 800H0Z" fill="#238bd1"/><text x="60" y="100" font-family="sans-serif" font-size="42" fill="#0f2333">ARCHIVED MEDIA</text></svg>',
  });
}

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}
