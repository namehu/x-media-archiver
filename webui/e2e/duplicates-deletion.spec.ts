import { expect, test, type Page } from "@playwright/test";

test.describe("Duplicates media deletion", () => {
  test.beforeEach(async ({ page }) => {
    await mockShellApis(page);
  });

  test("selects redundant members while keeping the suggested copy", async ({ page }) => {
    await mockDuplicates(page, createGroups());

    await page.goto("/duplicates");
    await page.getByRole("button", { name: "保留一项，选择其余" }).first().click();

    await expect(page.getByRole("checkbox", { name: "选择媒体 1" })).not.toBeChecked();
    await expect(page.getByRole("checkbox", { name: "选择媒体 2" })).toBeChecked();
    await expect(page.getByText("已选 1 项")).toBeVisible();
    await page.getByRole("checkbox", { name: "选择媒体 1" }).click();
    await expect(page).toHaveURL(/\/duplicates$/);
    await page.getByRole("button", { name: "删除" }).click();
    await expect(page.getByRole("alertdialog")).toContainText("1 个重复组的全部媒体");
  });

  test("deletes the selected media ids and refreshes the grouped page", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    let deleted = false;
    let deleteBody: Record<string, unknown> | null = null;
    await page.route("**/api/v1/library/duplicates?**", (route) =>
      route.fulfill({ json: duplicateResponse(deleted ? [] : createGroups()) }),
    );
    await page.route("**/api/v1/library/media", async (route) => {
      if (route.request().method() !== "DELETE") return route.fallback();
      deleteBody = route.request().postDataJSON() as Record<string, unknown>;
      deleted = true;
      await route.fulfill({
        json: {
          action: "delete-library-media",
          status: "completed",
          result: {
            operation_id: deleteBody.operation_id,
            deleted_media_count: 3,
            deleted_file_count: 3,
            deleted_bytes: 3072,
            missing_file_count: 0,
            tweet_ids: ["tweet-2", "tweet-4", "tweet-5"],
          },
        },
      });
    });

    await page.goto("/duplicates");
    await page.getByRole("button", { name: "选择本页冗余项" }).click();
    await expect(page.getByText("已选 3 项")).toBeVisible();
    await page.getByRole("button", { name: "删除" }).click();
    await page.getByRole("button", { name: "确认永久删除" }).click();

    await expect(page.getByText("已删除 3 项媒体，释放 3.0 KB")).toBeVisible();
    expect(deleteBody).toMatchObject({ media_ids: [2, 4, 5], confirm_physical_delete: true });
    expect(typeof deleteBody?.operation_id).toBe("string");
    await expect(page.getByText("没有重复媒体。").last()).toBeVisible();
  });

  test("keeps the selection and dialog open after a queue conflict", async ({ page }) => {
    await mockDuplicates(page, createGroups());
    await page.route("**/api/v1/library/media", async (route) => {
      if (route.request().method() !== "DELETE") return route.fallback();
      await route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({ detail: { code: "active_media_delete_queue_conflict", message: "active queue" } }),
      });
    });

    await page.goto("/duplicates");
    await page.getByRole("checkbox", { name: "选择媒体 2" }).click();
    await page.getByRole("button", { name: "删除" }).click();
    await page.getByRole("button", { name: "确认永久删除" }).click();

    await expect(page.getByRole("alertdialog")).toContainText("请先停止任务后重试");
    await page.getByRole("button", { name: "取消" }).click();
    await expect(page.getByRole("checkbox", { name: "选择媒体 2" })).toBeChecked();
  });

  test("caps a large duplicate group at 200 selected media", async ({ page }) => {
    const rows = Array.from({ length: 202 }, (_, index) => createMediaRow(index + 1, "verified"));
    await mockDuplicates(page, [
      {
        sha256: "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
        duplicate_count: rows.length,
        total_size: rows.length * 1024,
        rows,
      },
    ]);

    await page.goto("/duplicates");
    await page.getByRole("button", { name: "保留一项，选择其余" }).click();

    await expect(page.getByText("已选 200 项")).toBeVisible();
    await expect(page.getByText("已选择前 200 个重复媒体项，其余项目可分批处理。")).toBeVisible();
    await expect(page.getByRole("checkbox", { name: "选择媒体 1", exact: true })).not.toBeChecked();
    await expect(page.getByRole("checkbox", { name: "选择媒体 202", exact: true })).not.toBeChecked();
  });

  test("returns to the previous group page when deletion empties the last page", async ({ page }) => {
    const requestedOffsets: number[] = [];
    let deleted = false;
    const firstPageGroups = Array.from({ length: 20 }, (_, index) => createGroup(index + 1, (index + 1) * 10));
    const lastPageGroup = createGroup(21, 1000);
    await page.route("**/api/v1/library/duplicates?**", (route) => {
      const offset = Number(new URL(route.request().url()).searchParams.get("offset") ?? 0);
      requestedOffsets.push(offset);
      const groups = offset === 0 ? firstPageGroups : deleted ? [] : [lastPageGroup];
      const totalCount = deleted ? 20 : 21;
      return route.fulfill({
        json: {
          groups,
          count: groups.length,
          total_count: totalCount,
          limit: 20,
          offset,
          duplicate_groups: totalCount,
          total_media_count: totalCount * 2,
        },
      });
    });
    await page.route("**/api/v1/library/media", async (route) => {
      if (route.request().method() !== "DELETE") return route.fallback();
      const body = route.request().postDataJSON() as Record<string, unknown>;
      deleted = true;
      return route.fulfill({
        json: {
          action: "delete-library-media",
          status: "completed",
          result: {
            operation_id: body.operation_id,
            deleted_media_count: 1,
            deleted_file_count: 1,
            deleted_bytes: 1024,
            missing_file_count: 0,
            tweet_ids: ["tweet-1001"],
          },
        },
      });
    });

    await page.goto("/duplicates");
    await page.getByLabel("Next").first().click();
    await expect(page.getByText("第 21-21 组，共 21 组").first()).toBeVisible();
    await page.getByRole("button", { name: "保留一项，选择其余" }).click();
    await page.getByRole("button", { name: "删除" }).click();
    await page.getByRole("button", { name: "确认永久删除" }).click();

    await expect(page.getByText("第 1-20 组，共 20 组").first()).toBeVisible();
    expect(requestedOffsets).toContain(20);
    expect(requestedOffsets.at(-1)).toBe(0);
  });
});

async function mockDuplicates(page: Page, groups: ReturnType<typeof createGroups>) {
  await page.route("**/api/v1/library/duplicates?**", (route) =>
    route.fulfill({ json: duplicateResponse(groups) }),
  );
}

function duplicateResponse(groups: ReturnType<typeof createGroups>) {
  return {
    groups,
    count: groups.length,
    total_count: groups.length,
    limit: 20,
    offset: 0,
    duplicate_groups: groups.length,
    total_media_count: groups.reduce((total, group) => total + group.rows.length, 0),
  };
}

function createGroups() {
  return [
    {
      sha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      duplicate_count: 2,
      total_size: 2048,
      rows: [createMediaRow(1, "verified"), createMediaRow(2, "downloaded")],
    },
    {
      sha256: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      duplicate_count: 3,
      total_size: 3072,
      rows: [createMediaRow(3, "verified"), createMediaRow(4, "verified"), createMediaRow(5, "downloaded")],
    },
  ];
}

function createMediaRow(id: number, mediaStatus: string) {
  return {
    id,
    tweet_id: `tweet-${id}`,
    tweet_url: `https://x.com/example/status/tweet-${id}`,
    author_username: "example",
    media_index: 0,
    media_type: "photo",
    media_status: mediaStatus,
    local_path: `/archive/media/example/tweet-${id}/0.jpg`,
    media_url: `/api/v1/media-file/media/example/tweet-${id}/0.jpg`,
    file_size: 1024,
  };
}

function createGroup(groupNumber: number, firstMediaId: number) {
  return {
    sha256: String(groupNumber).padStart(64, "0"),
    duplicate_count: 2,
    total_size: 2048,
    rows: [createMediaRow(firstMediaId, "verified"), createMediaRow(firstMediaId + 1, "downloaded")],
  };
}

async function mockShellApis(page: Page) {
  await page.route("**/api/v1/auth/session", (route) =>
    route.fulfill({
      json: { status: "authenticated", auth_mode: "password", user: { username: "duplicates-test" } },
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
    route.fulfill({ status: 200, headers: { "content-type": "text/event-stream" }, body: "" }),
  );
  await page.route("**/api/v1/media-file/**", (route) => route.fulfill({ status: 404 }));
}
