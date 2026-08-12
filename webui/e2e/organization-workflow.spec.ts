import { expect, test, type Page, type Route } from "@playwright/test";

test("feed saves a private note before labels when the user submits immediately", async ({ page }) => {
  const requests: Array<{ path: string; body: Record<string, unknown> }> = [];
  await mockOrganizationApis(page, requests);

  await page.goto("/feed");
  await expect(page.getByText("organization workflow fixture")).toBeVisible();
  await page.getByRole("button", { name: "帖子操作" }).click();
  await page.getByRole("menuitem", { name: "整理标签、合集与备注" }).click();
  await page.getByText("重点", { exact: true }).click();
  await page.getByText("研究资料", { exact: true }).click();
  await page.getByLabel("私人备注").fill("需要稍后复盘");
  await page.getByRole("button", { name: "保存整理" }).click();

  await expect(page.getByText("标签与合集已保存")).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(requests).toEqual([
    {
      path: "/api/v1/library/tweets/organization-workflow/organization/note",
      body: { content: "需要稍后复盘" },
    },
    {
      path: "/api/v1/library/tweets/organization-workflow/organization/labels",
      body: { tag_ids: [1], collection_ids: [2] },
    },
  ]);
});

test("a failed note autosave waits for another edit before retrying", async ({ page }) => {
  const requests: Array<{ path: string; body: Record<string, unknown> }> = [];
  await mockOrganizationApis(page, requests, { failFirstNoteSave: true });

  await page.goto("/feed");
  await page.getByRole("button", { name: "帖子操作" }).click();
  await page.getByRole("menuitem", { name: "整理标签、合集与备注" }).click();
  await page.getByLabel("私人备注").fill("第一次保存会失败");

  await expect(page.getByText("自动保存失败，将在继续编辑后重试")).toBeVisible();
  await page.waitForTimeout(1_500);
  expect(noteSaveRequests(requests)).toHaveLength(1);

  await page.getByLabel("私人备注").fill("继续编辑后只重试一次");
  await expect(page.getByText("已自动保存")).toBeVisible();
  expect(noteSaveRequests(requests)).toEqual([
    { content: "第一次保存会失败" },
    { content: "继续编辑后只重试一次" },
  ]);
});

test("library keeps Tweet organization and media deletion as separate selection modes", async ({ page }) => {
  const requests: Array<{ path: string; body: Record<string, unknown> }> = [];
  await mockOrganizationApis(page, requests);

  await page.goto("/library");
  await page.getByRole("checkbox", { name: "选择 Tweet organization-workflow" }).first().click();
  await expect(page.getByText("已选 1 条 Tweet")).toBeVisible();
  await page.getByRole("button", { name: "批量整理" }).click();
  await page.getByText("重点", { exact: true }).click();
  await page.getByRole("button", { name: "应用批量整理" }).click();

  await expect(page.getByText("已整理 1 条 Tweet")).toBeVisible();
  expect(requests.at(-1)).toEqual({
    path: "/api/v1/library/organization/bulk",
    body: {
      tweet_ids: ["organization-workflow"],
      add_tag_ids: [1],
      remove_tag_ids: [],
      add_collection_ids: [],
      remove_collection_ids: [],
    },
  });

  await page.getByRole("radio", { name: "删除媒体" }).click();
  await expect(page.getByRole("checkbox", { name: "选择媒体 11" })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "选择媒体 12" })).toBeVisible();
});

async function mockOrganizationApis(
  page: Page,
  requests: Array<{ path: string; body: Record<string, unknown> }>,
  options: { failFirstNoteSave?: boolean } = {},
) {
  let noteSaveAttempts = 0;
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === "/api/v1/auth/session") {
      return json(route, {
        status: "authenticated",
        auth_mode: "password",
        user: { username: "organization-test" },
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
          active_sources: 0,
          paused_sources: 0,
          failed_sources: 0,
          history_enabled_sources: 0,
          active_scan_runs: 0,
        },
        recent_errors: [],
      });
    }
    if (url.pathname === "/api/v1/sources") {
      return json(route, { rows: [], count: 0, total_count: 0, limit: 200, offset: 0 });
    }
    if (url.pathname === "/api/v1/library/posts") {
      return json(route, {
        rows: [postRow()],
        count: 1,
        total_count: 1,
        limit: 20,
        offset: 0,
      });
    }
    if (url.pathname === "/api/v1/library/media") {
      return json(route, {
        rows: [mediaRow(11, 0), mediaRow(12, 1)],
        count: 2,
        total_count: 2,
        limit: 60,
        offset: 0,
      });
    }
    if (url.pathname === "/api/v1/library/organization" && request.method() === "GET") {
      return json(route, {
        tags: [{ id: 1, name: "重点", normalized_name: "重点", color: "#3366ff", tweet_count: 0 }],
        collections: [{ id: 2, name: "研究资料", normalized_name: "研究资料", tweet_count: 0 }],
      });
    }
    if (url.pathname === "/api/v1/library/tweets/organization-workflow/organization") {
      return json(route, { tweet_id: "organization-workflow", tags: [], collections: [], note: null });
    }
    if (request.method() !== "GET" && url.pathname.includes("organization")) {
      requests.push({ path: url.pathname, body: request.postDataJSON() as Record<string, unknown> });
      if (url.pathname.endsWith("/organization/note")) {
        noteSaveAttempts += 1;
        if (options.failFirstNoteSave && noteSaveAttempts === 1) {
          return json(route, { detail: "temporary failure" }, 500);
        }
      }
      const selected = (request.postDataJSON() as { tweet_ids?: string[] }).tweet_ids?.length ?? 0;
      return json(route, {
        action: "organization-test",
        status: "completed",
        result: { selected_tweet_count: selected },
      });
    }
    if (url.pathname === "/api/v1/events") {
      return route.fulfill({ status: 200, headers: { "content-type": "text/event-stream" }, body: "" });
    }
    if (url.pathname.startsWith("/api/v1/media-file/")) return route.fulfill({ status: 404 });
    return json(route, {}, 404);
  });
}

function postRow() {
  return {
    tweet_id: "organization-workflow",
    tweet_url: "https://x.com/example/status/organization-workflow",
    author_username: "example",
    author_display_name: "示例作者",
    published_at: "2026-01-01T00:00:00Z",
    tweet_text: "organization workflow fixture",
    tweet_status: "verified",
    tags: [],
    collection_count: 0,
    has_note: false,
    media: [mediaRow(11, 0), mediaRow(12, 1)].map((row) => ({
      ...row,
      media_relative_path: `media/example/organization-workflow/${row.media_index}.jpg`,
    })),
  };
}

function mediaRow(id: number, index: number) {
  return {
    id,
    tweet_id: "organization-workflow",
    tweet_url: "https://x.com/example/status/organization-workflow",
    author_username: "example",
    author_display_name: "示例作者",
    published_at: "2026-01-01T00:00:00Z",
    tweet_text: "organization workflow fixture",
    tweet_status: "verified",
    media_index: index,
    media_type: "photo",
    media_status: "verified",
    local_path: `/archive/media/example/organization-workflow/${index}.jpg`,
    media_url: `/api/v1/media-file/media/example/organization-workflow/${index}.jpg`,
    preview_url: "data:image/gif;base64,R0lGODlhAQABAAAAACw=",
    file_size: 1024,
  };
}

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

function noteSaveRequests(requests: Array<{ path: string; body: Record<string, unknown> }>) {
  return requests
    .filter((request) => request.path.endsWith("/organization/note"))
    .map((request) => request.body);
}
