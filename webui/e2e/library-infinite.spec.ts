import { expect, test, type Page } from "@playwright/test";

const PAGE_SIZE = 60;
const TOTAL_COUNT = 130;

test.describe("Library infinite loading", () => {
  test.beforeEach(async ({ page }) => {
    await mockShellApis(page);
  });

  test("loads successive pages and restores the grid after browser back", async ({ page }) => {
    const requestedOffsets: number[] = [];
    await page.route("**/api/v1/library/media?**", async (route) => {
      const url = new URL(route.request().url());
      const offset = Number(url.searchParams.get("offset") ?? 0);
      requestedOffsets.push(offset);
      await route.fulfill({
        json: {
          rows: createMediaRows(offset, Math.min(PAGE_SIZE, TOTAL_COUNT - offset)),
          count: Math.min(PAGE_SIZE, TOTAL_COUNT - offset),
          total_count: TOTAL_COUNT,
          limit: PAGE_SIZE,
          offset,
        },
      });
    });
    await page.route("**/api/v1/library/tweets/**", async (route) => {
      const tweetId = route.request().url().split("/").pop() ?? "tweet-0";
      const row = createMediaRow(Number(tweetId.replace("tweet-", "")) || 0);
      await route.fulfill({ json: { tweet: row, media: [row], attempts: [] } });
    });

    await page.goto("/library");
    await expect(page.getByText("已加载 60 项")).toBeVisible();
    expect(requestedOffsets).toEqual([0]);

    const loadedCount = await scrollUntilLoaded(page, 120);
    expect(requestedOffsets.slice(0, 2)).toEqual([0, 60]);
    expect(new Set(requestedOffsets).size).toBe(requestedOffsets.length);

    const scrollTop = await appScrollTop(page);
    await page.getByText("媒体 55", { exact: true }).click();
    await expect(page).toHaveURL(/\/tweets\/tweet-55$/);

    await page.goBack();
    await expect(page).toHaveURL(/\/library$/);
    await expect(page.getByText(`已加载 ${loadedCount} 项`)).toBeVisible();
    await expect
      .poll(() => appScrollTop(page))
      .toBeGreaterThanOrEqual(Math.max(0, scrollTop - 2));
    expect(new Set(requestedOffsets).size).toBe(requestedOffsets.length);
  });

  test("starts a new library visit at the top when using sidebar navigation", async ({ page }) => {
    await page.route("**/api/v1/library/media?**", async (route) => {
      const url = new URL(route.request().url());
      const offset = Number(url.searchParams.get("offset") ?? 0);
      await route.fulfill({
        json: {
          rows: createMediaRows(offset, Math.min(PAGE_SIZE, TOTAL_COUNT - offset)),
          count: Math.min(PAGE_SIZE, TOTAL_COUNT - offset),
          total_count: TOTAL_COUNT,
          limit: PAGE_SIZE,
          offset,
        },
      });
    });
    await page.route("**/api/v1/library/tweets/**", async (route) => {
      const row = createMediaRow(55);
      await route.fulfill({ json: { tweet: row, media: [row], attempts: [] } });
    });

    await page.goto("/library");
    await expect(page.getByText("已加载 60 项")).toBeVisible();
    await scrollUntilLoaded(page, 120);
    await page.getByText("媒体 55", { exact: true }).click();
    await expect(page).toHaveURL(/\/tweets\/tweet-55$/);

    await page.getByRole("link", { name: "媒体库" }).click();
    await expect(page).toHaveURL(/\/library$/);
    await expect.poll(() => appScrollTop(page)).toBe(0);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
  });

  test("selects and permanently deletes a media item after confirmation", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    let deleteBody: Record<string, unknown> | null = null;
    await page.route("**/api/v1/library/media?**", (route) =>
      route.fulfill({
        json: {
          rows: createMediaRows(0, 2),
          count: 2,
          total_count: 2,
          limit: PAGE_SIZE,
          offset: 0,
        },
      }),
    );
    await page.route("**/api/v1/library/media", async (route) => {
      if (route.request().method() !== "DELETE") return route.fallback();
      deleteBody = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({
        json: {
          action: "delete-library-media",
          status: "completed",
          result: {
            operation_id: deleteBody.operation_id,
            deleted_media_count: 1,
            deleted_file_count: 2,
            deleted_bytes: 1024,
            missing_file_count: 0,
            tweet_ids: ["tweet-0"],
          },
        },
      });
    });

    await page.goto("/library");
    await page.getByRole("radio", { name: "删除媒体" }).click();
    await page.getByRole("checkbox", { name: "选择媒体 1" }).click();
    await expect(page.getByText("已选 1 项")).toBeVisible();
    await page.getByRole("button", { name: "删除" }).click();
    await expect(page.getByRole("alertdialog")).toContainText("元数据和标准缩略图");
    await page.getByRole("button", { name: "确认永久删除" }).click();

    await expect(page.getByText("已删除 1 项媒体，释放 1.0 KB")).toBeVisible();
    expect(deleteBody).toMatchObject({ media_ids: [1], confirm_physical_delete: true });
    expect(typeof deleteBody?.operation_id).toBe("string");
  });
});

async function mockShellApis(page: Page) {
  await page.route("**/api/v1/auth/session", (route) =>
    route.fulfill({
      json: {
        status: "authenticated",
        auth_mode: "password",
        user: { username: "library-test" },
      },
    }),
  );
  await page.route("**/api/v1/health/detail", (route) =>
    route.fulfill({
      json: {
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
      },
    }),
  );
  await page.route("**/api/v1/events?**", (route) =>
    route.fulfill({
      status: 200,
      headers: { "content-type": "text/event-stream" },
      body: "",
    }),
  );
  await page.route("**/api/v1/media-file/**", (route) => route.fulfill({ status: 404 }));
}

async function scrollUntilLoaded(page: Page, minimum: number) {
  let loadedCount = 0;
  const scrollContainer = page.locator("[data-app-scroll-container]");
  await expect
    .poll(async () => {
      await scrollContainer.evaluate((element) => element.scrollTo(0, element.scrollHeight));
      await page.waitForTimeout(100);
      const label = await page.locator("span").filter({ hasText: /^已加载 \d+ 项$/ }).textContent();
      loadedCount = Number(label?.match(/\d+/)?.[0] ?? 0);
      return loadedCount;
    })
    .toBeGreaterThanOrEqual(minimum);
  return loadedCount;
}

async function appScrollTop(page: Page) {
  return page.locator("[data-app-scroll-container]").evaluate((element) => element.scrollTop);
}

function createMediaRows(offset: number, count: number) {
  return Array.from({ length: count }, (_, index) => createMediaRow(offset + index));
}

function createMediaRow(index: number) {
  return {
    id: index + 1,
    tweet_id: `tweet-${index}`,
    tweet_url: `https://x.com/example/status/tweet-${index}`,
    author_username: "example",
    author_display_name: "示例作者",
    published_at: "2026-01-01T00:00:00Z",
    tweet_text: `媒体 ${index}`,
    tweet_status: "verified",
    media_index: 0,
    media_type: "photo",
    media_status: "verified",
    local_path: `/archive/media/example/tweet-${index}/0.jpg`,
    media_url: `/api/v1/media-file/media/example/tweet-${index}/0.jpg`,
    file_size: 1024,
  };
}
