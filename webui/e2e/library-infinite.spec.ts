import { expect, test, type Page } from "@playwright/test";

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => sessionStorage.setItem("xma:webui:adult-content-acknowledged", "1"));
});

const PAGE_SIZE = 60;
const TOTAL_COUNT = 130;
const DETAIL_MEDIA_INDEX = 125;

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
    expect(requestedOffsets[0]).toBe(0);

    const loadedCount = await scrollUntilLoaded(page, TOTAL_COUNT);
    expect(new Set(requestedOffsets)).toEqual(new Set([0, 60, 120]));

    const scrollTop = await appScrollTop(page);
    await page.getByRole("button", { name: `媒体 ${DETAIL_MEDIA_INDEX}`, exact: true }).click();
    await expect(page.getByRole("dialog")).toContainText(`媒体 ${DETAIL_MEDIA_INDEX}`);
    await page.getByRole("button", { name: "Tweet 详情" }).click();
    await expect(page).toHaveURL(new RegExp(`/tweets/tweet-${DETAIL_MEDIA_INDEX}$`));

    await page.goBack();
    await expect(page).toHaveURL(/\/library$/);
    await expect(page.getByText(`已加载 ${loadedCount} 项`)).toBeVisible();
    await expect
      .poll(() => appScrollTop(page))
      .toBeGreaterThanOrEqual(Math.max(0, scrollTop - 2));
    expect(new Set(requestedOffsets)).toEqual(new Set([0, 60, 120]));
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
    await page.goto("/library");
    await expect(page.getByText("已加载 60 项")).toBeVisible();
    await scrollUntilLoaded(page, 120);
    await page.getByRole("link", { name: "媒体", exact: true }).click();
    await expect(page).toHaveURL(/\/library$/);
    await expect.poll(() => appScrollTop(page)).toBe(0);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
  });

  test("starts in media-wall browse mode and remembers view preferences", async ({ page }) => {
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

    await page.goto("/library");
    await expect(page.getByText("已加载 2 项")).toBeVisible();
    await expect(page.getByRole("checkbox")).toHaveCount(0);
    await expect(page.getByRole("radio")).toHaveCount(0);
    await page.getByRole("button", { name: "显示设置" }).click();
    await expect(page.getByRole("menuitemradio", { name: "媒体墙" })).toHaveAttribute("aria-checked", "true");
    await page.getByRole("menuitemradio", { name: "紧凑" }).click();
    await page.getByRole("button", { name: "显示设置" }).click();
    await page.getByRole("menuitemradio", { name: "详情" }).click();
    await expect(page.getByRole("button", { name: "显示设置，当前为详情" })).toBeVisible();
    await page.getByRole("button", { name: "筛选" }).click();
    await expect(page.getByRole("heading", { name: "筛选媒体" })).toBeVisible();
    await page.getByRole("button", { name: "关闭面板" }).click();

    await page.reload();
    await expect(page.getByRole("dialog", { name: "筛选媒体" })).toHaveCount(0);
    await page.getByRole("button", { name: "显示设置" }).click();
    await expect(page.getByRole("menuitemradio", { name: "详情" })).toHaveAttribute("aria-checked", "true");
    await page.getByRole("menuitemradio", { name: "媒体墙" }).click();
    await page.getByRole("button", { name: "显示设置" }).click();
    await expect(page.getByRole("menuitemradio", { name: "紧凑" })).toHaveAttribute("aria-checked", "true");
  });

  test("keeps active filter details inside the filter sheet", async ({ page }) => {
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

    await page.goto("/library");
    await expect(page.getByText("状态：已校验")).toHaveCount(0);
    await page.getByRole("button", { name: "筛选", exact: true }).click();
    await page.getByLabel("Tweet 文本").fill("旅行");
    await page.getByRole("button", { name: "查看结果" }).click();

    await expect(page.getByRole("button", { name: "筛选，已启用 1 项" })).toBeVisible();
    await expect(page.getByText("文本：旅行")).toHaveCount(0);
    await expect(page.getByRole("dialog", { name: "筛选媒体" })).toHaveCount(0);
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
    await expect(page.getByRole("heading", { name: "媒体" })).toHaveCount(1);
    await expect
      .poll(() =>
        page.locator("[data-app-scroll-container]").evaluate((element) => element.scrollWidth <= element.clientWidth),
      )
      .toBe(true);
    await page.getByRole("button", { name: "筛选" }).click();
    await expect(page.getByRole("dialog", { name: "筛选媒体" })).toBeVisible();
    await page.getByRole("button", { name: "关闭面板" }).click();
    await expect(page.getByRole("checkbox")).toHaveCount(0);
    await page.getByRole("button", { name: "批量操作和更多选项" }).click();
    await page.getByRole("menuitem", { name: "删除媒体" }).click();
    await page.getByRole("checkbox", { name: "选择媒体 1" }).click();
    await expect(page.getByText("已选 1 项媒体", { exact: true }).first()).toBeVisible();
    await page.getByRole("button", { name: "删除" }).click();
    await expect(page.getByRole("alertdialog")).toContainText("元数据和标准缩略图");
    await page.getByRole("button", { name: "确认永久删除" }).click();

    await expect(page.getByText("已删除 1 项媒体，释放 1.0 KB")).toBeVisible();
    expect(deleteBody).toMatchObject({ media_ids: [1], confirm_physical_delete: true });
    expect(typeof deleteBody?.operation_id).toBe("string");
  });

  test("previews a media item and quick-deletes it before advancing", async ({ page }) => {
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
    await expect(page.getByText("已加载 2 项")).toBeVisible();
    await page.getByRole("button", { name: "媒体 0", exact: true }).click();
    await expect(page.getByRole("dialog")).toContainText("媒体 0");
    await page.getByRole("button", { name: "永久删除当前媒体" }).click();
    await expect(page.getByRole("alertdialog")).toContainText("任务历史和删除审计会保留");
    await page.getByRole("button", { name: "永久删除此媒体" }).click();

    await expect(page.getByText("已删除 1 项媒体，释放 1.0 KB")).toBeVisible();
    await expect(page.getByRole("dialog")).toContainText("媒体 1");
    expect(deleteBody).toMatchObject({ media_ids: [1], confirm_physical_delete: true });
  });
});

const SKIP_DELETE_CONFIRMATION_KEY = "xma:webui:library-delete-confirmation-skipped";
type DeleteBody = { operation_id: string; media_ids: number[]; confirm_physical_delete: boolean };

test.describe("Library session deletion", () => {
  test.beforeEach(async ({ page }) => {
    await mockShellApis(page);
  });

  test("remembers only confirmed opt-in across preview, reload and batch deletion", async ({ page, context }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const bodies: DeleteBody[] = [];
    await mockDeletableMedia(page, bodies, 5);
    await page.goto("/library");
    await page.getByRole("button", { name: "媒体 0", exact: true }).click();
    await page.keyboard.press("Delete");
    const dialog = page.getByRole("alertdialog");
    const checkbox = dialog.getByRole("checkbox", { name: "本次不再提示" });
    await expect(checkbox).not.toBeChecked();
    await checkbox.check();
    await expect(dialog).toContainText("当前标签页会话内有效，刷新后仍生效");
    await page.screenshot({ animations: "disabled", path: testInfo.outputPath("confirmation-mobile-light.png") });
    await dialog.getByRole("button", { name: "取消", exact: true }).click();
    expect(await page.evaluate((key) => sessionStorage.getItem(key), SKIP_DELETE_CONFIRMATION_KEY)).toBeNull();
    expect(bodies).toHaveLength(0);

    await page.keyboard.press("Delete");
    await expect(checkbox).not.toBeChecked();
    await dialog.getByRole("button", { name: "永久删除此媒体", exact: true }).click();
    await expect(page.getByRole("dialog")).toContainText("媒体 1");
    await expect(page.getByRole("button", { name: "永久删除当前媒体" })).toBeEnabled();
    await page.keyboard.press("Delete");
    await expect(dialog).toBeVisible();
    await checkbox.check();
    await dialog.getByRole("button", { name: "永久删除此媒体", exact: true }).click();
    await expect(page.getByRole("dialog")).toContainText("媒体 2");
    await expect(page.getByRole("button", { name: "永久删除当前媒体" })).toBeEnabled();
    await page.getByRole("button", { name: "永久删除当前媒体" }).click();
    await expect(page.getByRole("dialog")).toContainText("媒体 3");
    await expect(dialog).toHaveCount(0);
    expect(bodies.map((body) => body.media_ids)).toEqual([[1], [2], [3]]);
    expect(new Set(bodies.map((body) => body.operation_id)).size).toBe(3);

    await page.reload();
    await enterDeleteSelection(page, [4, 5]);
    await page.keyboard.press("Delete");
    await expect(page.getByText("当前筛选条件下没有媒体")).toBeVisible();
    await expect(dialog).toHaveCount(0);
    expect(bodies[3]).toMatchObject({ media_ids: [4, 5], confirm_physical_delete: true });

    const newTab = await context.newPage();
    await mockShellApis(newTab);
    await mockDeletableMedia(newTab, [], 1);
    await newTab.goto("/library");
    await newTab.getByRole("button", { name: "媒体 0", exact: true }).click();
    await newTab.keyboard.press("Delete");
    await expect(newTab.getByRole("alertdialog")).toBeVisible();
    await newTab.close();
  });

  test("ignores missing targets, organization selections, input focus and covering overlays", async ({ page }) => {
    const bodies: DeleteBody[] = [];
    await mockDeletableMedia(page, bodies, 3);
    await page.goto("/library");
    await page.evaluate((key) => sessionStorage.setItem(key, "1"), SKIP_DELETE_CONFIRMATION_KEY);
    await expect(page.getByText("已加载 3 项")).toBeVisible();
    await page.keyboard.press("Delete");
    await page.getByRole("button", { name: "批量操作和更多选项" }).click();
    await page.getByRole("menuitem", { name: "整理 Tweet" }).click();
    await page.getByRole("checkbox").first().check();
    await page.keyboard.press("Delete");
    expect(bodies).toHaveLength(0);
    await page.keyboard.press("Escape");

    await enterDeleteSelection(page, [1, 2]);
    await page.getByRole("button", { name: "账户菜单" }).click();
    await page.keyboard.press("Delete");
    expect(bodies).toHaveLength(0);
    await page.keyboard.press("Escape");
    await page.keyboard.press("Control+k");
    await expect(page.getByRole("combobox")).toBeVisible();
    await page.getByRole("combobox").fill("test");
    await page.getByRole("combobox").evaluate((element: HTMLInputElement) => element.setSelectionRange(0, 1));
    await page.keyboard.press("Delete");
    await expect(page.getByRole("combobox")).toHaveValue("est");
    await page.getByRole("dialog").focus();
    await page.keyboard.press("Delete");
    expect(bodies).toHaveLength(0);
    await page.keyboard.press("Escape");
    await page.keyboard.press("Backspace");
    await page.keyboard.press("Shift+Delete");
    expect(bodies).toHaveLength(0);
    await page.getByRole("button", { name: "删除", exact: true }).click();
    await expect(page.getByText("已删除 2 项媒体，释放 2.0 KB")).toBeVisible();
    expect(bodies[0].media_ids).toEqual([1, 2]);

    await page.getByRole("button", { name: "媒体 2", exact: true }).click();
    await page.getByRole("dialog").evaluate((element) => {
      const input = document.createElement("div");
      input.contentEditable = "true";
      input.setAttribute("aria-label", "编辑测试");
      input.textContent = "abc";
      element.appendChild(input);
      input.focus();
    });
    await page.keyboard.press("Delete");
    expect(bodies).toHaveLength(1);
    await page.getByLabel("编辑测试").evaluate((element) => element.remove());
    await page.getByRole("dialog").focus();
    await page.keyboard.press("Delete");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(bodies[1].media_ids).toEqual([3]);
  });

  test("locks pending requests and ignores held Delete even after advancing", async ({ page }) => {
    const bodies: DeleteBody[] = [];
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    await mockDeletableMedia(page, bodies, 3, async () => { await pending; return false; });
    await page.goto("/library");
    await page.evaluate((key) => sessionStorage.setItem(key, "1"), SKIP_DELETE_CONFIRMATION_KEY);
    await page.getByRole("button", { name: "媒体 0", exact: true }).click();
    await page.keyboard.down("Delete");
    await expect(page.getByRole("button", { name: "永久删除当前媒体" })).toBeDisabled();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.down("Delete");
    await page.getByRole("dialog").dispatchEvent("keydown", { key: "Delete" });
    expect(bodies).toHaveLength(1);
    await expect(page.getByRole("dialog")).toContainText("媒体 0");
    release();
    await expect(page.getByRole("dialog")).toContainText("媒体 1");
    await expect(page.getByRole("button", { name: "永久删除当前媒体" })).toBeEnabled();
    await page.keyboard.down("Delete");
    expect(bodies).toHaveLength(1);
    await page.keyboard.up("Delete");
    await page.getByRole("dialog").evaluate(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete" }));
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete" }));
    });
    await expect(page.getByRole("dialog")).toContainText("媒体 2");
    expect(bodies.map((body) => body.media_ids)).toEqual([[1], [2]]);
  });

  test("shows quick-delete errors and retries the exact operation", async ({ page }, testInfo) => {
    const bodies: DeleteBody[] = [];
    await mockDeletableMedia(page, bodies, 3, async () => bodies.length === 1);
    await page.goto("/library");
    await page.evaluate((key) => sessionStorage.setItem(key, "1"), SKIP_DELETE_CONFIRMATION_KEY);
    await page.getByRole("button", { name: "媒体 2", exact: true }).click();
    await page.keyboard.press("Delete");
    await expect(page.getByRole("dialog")).toContainText("媒体 2");
    await expect(page.getByRole("alert")).toContainText("请先停止任务后重试");
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    await page.screenshot({ animations: "disabled", path: testInfo.outputPath("preview-delete-error-desktop.png") });
    await page.getByRole("button", { name: "重试删除" }).click();
    await expect(page.getByRole("dialog")).toContainText("媒体 1");
    expect(bodies[1]).toEqual(bodies[0]);
    await expect(page.getByRole("alert")).toHaveCount(0);

    await page.evaluate((key) => sessionStorage.removeItem(key), SKIP_DELETE_CONFIRMATION_KEY);
    await expect(page.getByRole("button", { name: "永久删除当前媒体" })).toBeEnabled();
    await page.keyboard.press("Delete");
    await expect(page.getByRole("alertdialog")).toBeVisible();
    await page.evaluate(() => document.documentElement.classList.add("dark"));
    await page.screenshot({ animations: "disabled", path: testInfo.outputPath("confirmation-desktop-dark.png") });
  });

  test("keeps failed batch targets and reuses their operation on Del retry", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const bodies: DeleteBody[] = [];
    await mockDeletableMedia(page, bodies, 2, async () => bodies.length < 3);
    await page.goto("/library");
    await page.evaluate((key) => {
      sessionStorage.setItem(key, "1");
      document.documentElement.classList.add("dark");
    }, SKIP_DELETE_CONFIRMATION_KEY);
    await enterDeleteSelection(page, [1, 2]);
    await page.keyboard.press("Delete");
    await expect(page.getByRole("alert")).toContainText("请先停止任务后重试");
    await expect(page.getByRole("checkbox", { name: "选择媒体 1", exact: true })).toBeChecked();
    await expect(page.getByRole("checkbox", { name: "选择媒体 2", exact: true })).toBeChecked();
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "删除", exact: true })).toBeEnabled();
    await page.screenshot({ animations: "disabled", path: testInfo.outputPath("batch-delete-error-mobile-dark.png") });
    await page.keyboard.press("Delete");
    await expect.poll(() => bodies.length).toBe(2);
    await expect(page.getByRole("alert")).toContainText("请先停止任务后重试");
    expect(bodies[1]).toEqual(bodies[0]);
    await page.getByRole("button", { name: "重试删除" }).click();
    await expect(page.getByText("当前筛选条件下没有媒体")).toBeVisible();
    expect(bodies[2]).toEqual(bodies[0]);
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    await expect(page.locator("[data-app-scroll-container]")).toBeVisible();
    expect(await page.locator("[data-app-scroll-container]").evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  });

  for (const blockedMethod of ["getItem", "setItem"] as const) {
    test(`keeps asking when sessionStorage ${blockedMethod} fails`, async ({ page }) => {
      const bodies: DeleteBody[] = [];
      await mockDeletableMedia(page, bodies, 2);
      await page.goto("/library");
      await page.evaluate(({ key, method }) => {
        const original = Storage.prototype[method];
        Object.defineProperty(Storage.prototype, method, {
          value: function (this: Storage, ...args: string[]) {
            if (this === sessionStorage && args[0] === key) throw new DOMException("Blocked", "SecurityError");
            return Reflect.apply(original, this, args);
          },
        });
      }, { key: SKIP_DELETE_CONFIRMATION_KEY, method: blockedMethod });
      await page.getByRole("button", { name: "媒体 0", exact: true }).click();
      await page.keyboard.press("Delete");
      await page.getByRole("checkbox", { name: "本次不再提示" }).check();
      await page.getByRole("button", { name: "永久删除此媒体", exact: true }).click();
      await expect(page.getByRole("dialog")).toContainText("媒体 1");
      await expect(page.getByRole("button", { name: "永久删除当前媒体" })).toBeEnabled();
      await page.keyboard.press("Delete");
      await expect(page.getByRole("alertdialog")).toBeVisible();
      expect(bodies).toHaveLength(1);
    });
  }
});

async function enterDeleteSelection(page: Page, ids: number[]) {
  await page.getByRole("button", { name: "批量操作和更多选项" }).click();
  await page.getByRole("menuitem", { name: "删除媒体", exact: true }).click();
  for (const id of ids) await page.getByRole("checkbox", { name: `选择媒体 ${id}`, exact: true }).check();
}

async function mockDeletableMedia(
  page: Page,
  bodies: DeleteBody[],
  count: number,
  shouldFail: () => Promise<boolean> = async () => false,
) {
  let rows = createMediaRows(0, count);
  await page.route("**/api/v1/library/media?**", (route) => route.fulfill({
    json: { rows, count: rows.length, total_count: rows.length, limit: PAGE_SIZE, offset: 0 },
  }));
  await page.route("**/api/v1/library/media", async (route) => {
    if (route.request().method() !== "DELETE") return route.fallback();
    const body = route.request().postDataJSON() as DeleteBody;
    bodies.push(body);
    if (await shouldFail()) return route.fulfill({ status: 409, json: { detail: "media in use" } });
    rows = rows.filter((row) => !body.media_ids.includes(row.id));
    return route.fulfill({ json: {
      action: "delete-library-media",
      status: "completed",
      result: {
        operation_id: body.operation_id,
        deleted_media_count: body.media_ids.length,
        deleted_file_count: body.media_ids.length,
        deleted_bytes: 1024 * body.media_ids.length,
        missing_file_count: 0,
        tweet_ids: body.media_ids.map((id) => `tweet-${id - 1}`),
      },
    } });
  });
}

async function mockShellApis(page: Page) {
  await page.routeWebSocket("**/api/v1/runtime/ws", (socket) => socket.close());
  await page.route("**/api/v1/auth/session", (route) =>
    route.fulfill({
      json: {
        status: "authenticated",
        auth_mode: "password",
        user: { username: "library-test", media_privacy_mode: false },
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
  await page.route("**/api/v1/runtime/snapshot", (route) =>
    route.fulfill({ json: runtimeSnapshot() }),
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

function runtimeSnapshot() {
  return {
    epoch: "library-e2e",
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
      active_sources: 0,
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
