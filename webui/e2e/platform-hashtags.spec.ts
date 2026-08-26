import { expect, test, type Page, type Route } from "@playwright/test";

test("feed and preview distinguish platform Hashtags from custom tags", async ({ page }) => {
  await mockPlatformHashtagApis(page);
  await page.setViewportSize({ width: 390, height: 844 });

  await page.goto("/feed");
  await expect(page.getByText("platform hashtag fixture", { exact: true })).toBeVisible();
  await expect(page.getByLabel("平台 Hashtag", { exact: true }).first()).toContainText("#AI");
  await expect(page.getByText("自定义标签", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("重点", { exact: true }).first()).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  const hashtagLink = page.getByRole("link", { name: "搜索平台 Hashtag #AI" }).first();
  await expect(hashtagLink).toHaveAttribute("href", "/search?hashtag=AI&tweet_status=all");

  await page.getByRole("button", { name: "预览第 1 个媒体" }).click();
  const preview = page.getByRole("dialog");
  await expect(preview).toBeVisible();
  await expect(preview.getByLabel("平台 Hashtag", { exact: true })).toContainText("#AI");
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.keyboard.press("Escape");
  await hashtagLink.click();
  await expect(page).toHaveURL(/\/search\?hashtag=AI&tweet_status=all$/);
});

test("search persists one exact Hashtag in the URL and requests bounded suggestions", async ({ page }) => {
  const requests: URL[] = [];
  await mockPlatformHashtagApis(page, { hashtagRequests: requests });

  await page.goto("/search?hashtag=AI&tweet_status=all");
  await page.getByRole("button", { name: /^筛选/ }).click();
  await expect(page.getByRole("combobox", { name: "选择平台 Hashtag" })).toContainText("#AI");
  await expect(page.getByLabel("平台 Hashtag", { exact: true }).first()).toContainText("#AI");
  await expect(page.getByText("自定义标签", { exact: true }).first()).toBeVisible();

  await page.getByRole("combobox", { name: "选择平台 Hashtag" }).click();
  const optionsList = page.locator("[cmdk-list]");
  await page.getByPlaceholder("搜索平台 Hashtag").fill("Open");
  await expect(optionsList.getByText("#OpenAI", { exact: true })).toBeVisible();
  await optionsList.getByText("#OpenAI", { exact: true }).click();
  await page.getByRole("button", { name: "应用筛选", exact: true }).click();

  await expect(page).toHaveURL(/hashtag=OpenAI/);
  await expect.poll(() => requests.some((url) => url.searchParams.get("q") === "Open")).toBe(true);
  expect(requests.every((url) => url.searchParams.get("limit") === "20")).toBe(true);

  await page.reload();
  await page.getByRole("button", { name: /^筛选/ }).click();
  await expect(page.getByRole("combobox", { name: "选择平台 Hashtag" })).toContainText("#OpenAI");
});

test("Hashtag suggestions expose loading, error retry, and empty states", async ({ page }) => {
  let failuresRemaining = 1;
  await mockPlatformHashtagApis(page, { hashtagFailures: () => failuresRemaining-- > 0, hashtagDelayMs: 250 });

  await page.goto("/search");
  await page.getByRole("button", { name: "筛选", exact: true }).click();
  await page.getByRole("combobox", { name: "选择平台 Hashtag" }).click();
  const optionsList = page.locator("[cmdk-list]");
  await expect(optionsList.getByText("正在搜索平台 Hashtag…")).toBeVisible();
  await expect(optionsList.getByText("平台 Hashtag 加载失败")).toBeVisible();
  await optionsList.getByRole("button", { name: "重试" }).click();
  await expect(optionsList.getByText("#AI", { exact: true })).toBeVisible();

  await page.getByPlaceholder("搜索平台 Hashtag").fill("not-found");
  await expect(optionsList.getByText("没有匹配的平台 Hashtag")).toBeVisible();
});

test("detail shows read-only Hashtags and debugger mode removes search-result links", async ({ page }) => {
  await mockPlatformHashtagApis(page);

  await page.goto("/tweets/platform-hashtag-fixture");
  await expect(page.getByLabel("平台 Hashtag", { exact: true })).toContainText("#AI");
  await expect(page.getByText("自定义标签", { exact: true })).toBeVisible();

  await page.goto("/search?debugger=1&hashtag=AI&tweet_status=all");
  const redactedHashtags = page.locator('article [aria-label="平台 Hashtag"]');
  await expect(redactedHashtags).toContainText("#AI");
  await expect(page.getByRole("link", { name: "搜索平台 Hashtag #AI" })).toHaveCount(0);
  await expect(redactedHashtags).not.toHaveCSS("filter", "none");
});

async function mockPlatformHashtagApis(
  page: Page,
  options: {
    hashtagRequests?: URL[];
    hashtagFailures?: () => boolean;
    hashtagDelayMs?: number;
  } = {},
) {
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/v1/auth/session") {
      return json(route, {
        status: "authenticated",
        auth_mode: "password",
        user: { username: "platform-hashtag-test" },
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
    if (url.pathname === "/api/v1/library/search/options") {
      return json(route, {
        tags: [{ id: 1, name: "重点", color: null, tweet_count: 1 }],
        collections: [{ id: 1, name: "研究", tweet_count: 1 }],
      });
    }
    if (url.pathname === "/api/v1/library/search/hashtags") {
      options.hashtagRequests?.push(url);
      if (options.hashtagDelayMs) await new Promise((resolve) => setTimeout(resolve, options.hashtagDelayMs));
      if (options.hashtagFailures?.()) return json(route, { detail: "fixture failure" }, 500);
      const q = url.searchParams.get("q") ?? "";
      const rows = q === "not-found"
        ? []
        : q === "Open"
          ? [{ name: "OpenAI", normalized_name: "openai", tweet_count: 3 }]
          : [{ name: "AI", normalized_name: "ai", tweet_count: 7 }];
      return json(route, { rows, count: rows.length });
    }
    if (url.pathname === "/api/v1/library/posts") {
      return json(route, pageResponse(postRow()));
    }
    if (url.pathname === "/api/v1/library/search") {
      return json(route, pageResponse({
        ...postRow(),
        relevance: 1,
        collections: ["研究"],
        note_excerpt: "私人备注",
      }));
    }
    if (url.pathname === "/api/v1/library/tweets/platform-hashtag-fixture") {
      const post = postRow();
      return json(route, {
        tweet: {
          ...post.media[0],
          tweet_url: post.tweet_url,
          author_username: post.author_username,
          author_display_name: post.author_display_name,
          published_at: post.published_at,
          tweet_text: post.tweet_text,
          tweet_status: post.tweet_status,
          imported_at: "2026-08-14T01:00:00Z",
          updated_at: "2026-08-14T01:00:00Z",
        },
        hashtags: post.hashtags,
        media: post.media,
        attempts: [],
        organization: {
          tweet_id: post.tweet_id,
          tags: [{ id: 1, name: "重点", normalized_name: "重点", color: null }],
          collections: [{ id: 1, name: "研究", normalized_name: "研究", cover_media_id: null }],
          note: null,
        },
      });
    }
    if (url.pathname === "/api/v1/events") {
      return route.fulfill({ status: 200, headers: { "content-type": "text/event-stream" }, body: "" });
    }
    return json(route, {}, 404);
  });
}

function postRow() {
  return {
    tweet_id: "platform-hashtag-fixture",
    tweet_url: "https://x.com/example/status/platform-hashtag-fixture",
    author_username: "example",
    author_display_name: "示例作者",
    published_at: "2026-08-14T00:00:00Z",
    tweet_text: "platform hashtag fixture",
    tweet_status: "verified",
    hashtags: ["AI", "OpenAI", "VeryLongPlatformHashtagThatMustStayInsideTheNarrowCard"],
    tags: ["重点"],
    collection_count: 1,
    has_note: true,
    media: [
      {
        id: 501,
        tweet_id: "platform-hashtag-fixture",
        media_index: 0,
        media_type: "photo",
        media_status: "verified",
        source_engine: "gallery-dl",
        local_path: "/archive/media/example/platform-hashtag-fixture/0.jpg",
        media_relative_path: "media/example/platform-hashtag-fixture/0.jpg",
        media_url: "data:image/gif;base64,R0lGODlhAQABAAAAACw=",
        preview_relative_path: null,
        preview_url: null,
        file_size: 43,
        width: 1,
        height: 1,
        duration_ms: null,
      },
    ],
  };
}

function pageResponse(row: ReturnType<typeof postRow> | (ReturnType<typeof postRow> & Record<string, unknown>)) {
  return { rows: [row], count: 1, total_count: 1, limit: 20, offset: 0 };
}

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}
