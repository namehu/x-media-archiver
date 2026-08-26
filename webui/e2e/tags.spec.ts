import { expect, test, type Page, type Route } from "@playwright/test";

test("custom tags scale as a searchable virtualized directory with independent management", async ({ page }) => {
  const writes: Array<{ method: string; path: string; body: unknown }> = [];
  await mockTagsApis(page, writes);

  await page.goto("/tags");

  await expect(page.getByRole("heading", { name: "自定义标签", exact: true })).toBeVisible();
  await expect(page.getByText("121 个标签", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "重点研究", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "标签管理" })).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await page.getByRole("button", { name: "标签操作：重点研究" }).click();
  await page.getByRole("menuitem", { name: "编辑" }).click();
  const editor = page.getByRole("dialog", { name: "编辑自定义标签" });
  await editor.getByLabel("名称").fill("重点研究更新");
  await editor.getByRole("button", { name: "保存" }).click();
  await expect.poll(() => writes.some((request) => request.method === "PUT" && request.path.endsWith("/tags/999"))).toBe(true);

  const search = page.getByLabel("搜索自定义标签");
  await search.fill("重点");
  await expect(page.getByText("显示 1 / 121 个标签")).toBeVisible();
  await expect(page.getByRole("link", { name: "查看“重点研究”标签下的 Tweet" })).toHaveAttribute("href", "/search?tag_id=999");
  await search.fill("");

  await page.getByRole("button", { name: "排序：使用量" }).click();
  await page.getByRole("menuitem", { name: "按名称" }).click();
  await expect(page).toHaveURL(/sort=name/);
  await expect(page.getByRole("heading", { name: "标签 001", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "标签操作：标签 001" }).click();
  await page.getByRole("menuitem", { name: "删除" }).click();
  const confirmation = page.getByRole("alertdialog", { name: "删除“标签 001”？" });
  await expect(confirmation.getByText("Tweet、媒体文件、下载任务、合集与私人备注都不会被删除")).toBeVisible();
  await confirmation.getByRole("button", { name: "确认删除并解除关系" }).click();
  await expect.poll(() => writes.some((request) => request.method === "DELETE" && request.path.endsWith("/tags/120"))).toBe(true);

  await page.evaluate(() => localStorage.setItem("x-archiver-theme", "dark"));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect(page.getByLabel("搜索自定义标签")).toBeVisible();
  await expect(page.getByRole("heading", { name: "标签 001", exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

async function mockTagsApis(page: Page, writes: Array<{ method: string; path: string; body: unknown }>) {
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());

    if (url.pathname === "/api/v1/auth/session") {
      return json(route, {
        status: "authenticated",
        auth_mode: "password",
        user: { username: "tags-test" },
      });
    }
    if (url.pathname === "/api/v1/health/detail") return json(route, healthFixture());
    if (url.pathname === "/api/v1/runtime/snapshot") return json(route, runtimeSnapshot());
    if (url.pathname === "/api/v1/library/organization" && request.method() === "GET") {
      return json(route, { tags: tagsFixture(), collections: [] });
    }
    if (url.pathname.startsWith("/api/v1/library/organization/tags/") && request.method() !== "GET") {
      writes.push({
        method: request.method(),
        path: url.pathname,
        body: request.postData() ? request.postDataJSON() : null,
      });
      return json(route, { action: "tag-test", status: "completed", result: {} });
    }
    if (url.pathname === "/api/v1/events") {
      return route.fulfill({ status: 200, headers: { "content-type": "text/event-stream" }, body: "" });
    }
    return json(route, {}, 404);
  });
}

function tagsFixture() {
  return [
    {
      id: 999,
      name: "重点研究",
      normalized_name: "重点研究",
      description: "需要持续回看的研究资料。",
      color: "#3366ff",
      tweet_count: 999,
    },
    ...Array.from({ length: 120 }, (_, index) => {
      const number = 120 - index;
      const label = String(number).padStart(3, "0");
      return {
        id: index + 1,
        name: `标签 ${label}`,
        normalized_name: `标签 ${label}`,
        description: `用于验证大规模标签目录的第 ${label} 个标签。`,
        color: index % 2 ? "#8b5cf6" : "#0096fa",
        tweet_count: number,
      };
    }),
  ];
}

function healthFixture() {
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

function runtimeSnapshot() {
  return {
    epoch: "tags-e2e",
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
