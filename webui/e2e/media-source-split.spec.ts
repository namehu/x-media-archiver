import { expect, test, type Page } from "@playwright/test";

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => sessionStorage.setItem("xma:webui:adult-content-acknowledged", "1"));
});

for (const width of [1440, 390]) {
  test(`media source selection and first scan at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const fixture = await mockSources(page);
    await page.goto("/sources");
    await page.getByRole("button", { name: "新增来源", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("来源 URL").fill("https://x.com/splitfixture/media?filter=photo");
    await expect(dialog.getByRole("combobox")).toContainText("博主图片");
    await dialog.getByRole("combobox").click();
    await expect(page.getByRole("option", { name: "旧媒体来源" })).toHaveCount(0);
    await page.getByRole("option", { name: "博主视频", exact: true }).click();
    await expect(dialog.getByLabel("来源 URL")).toHaveValue("https://x.com/splitfixture/media");
    await dialog.getByRole("combobox").click();
    await page.getByRole("option", { name: "博主图片", exact: true }).click();
    await expect(dialog.getByLabel("来源 URL")).toHaveValue("https://x.com/splitfixture/media?filter=photo");
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await dialog.getByRole("button", { name: "新增来源", exact: true }).click();
    await expect.poll(() => fixture.created).toMatchObject({ source_type: "user_photos", source_url: "https://x.com/splitfixture/media?filter=photo" });
    await expect(page.getByRole("button", { name: "开始扫描", exact: true })).toBeEnabled();
    await expect(page.getByRole("button", { name: /恢复.*扫描/ })).toHaveCount(0);
    await page.getByRole("button", { name: "开始扫描", exact: true }).click();
    await page.getByRole("button", { name: "确认开始扫描", exact: true }).click();
    await expect.poll(() => fixture.scan).toMatchObject({ mode: "history" });
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "暂停", exact: true })).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `/tmp/xma-media-source-${width}.png`, animations: "disabled" });
  });

  test(`legacy source is read only and excluded from selection at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await mockSources(page);
    await page.goto("/sources");
    await page.getByRole("button", { name: "批量选择", exact: true }).click();
    await expect(page.getByRole("checkbox", { name: "选择历史媒体样本", exact: true })).toBeDisabled();
    await page.getByRole("checkbox", { name: "选择当前筛选下的全部来源", exact: true }).click();
    await expect(page.getByText("已选择 2 个来源", { exact: true })).toBeVisible();
    await expect(page.getByRole("checkbox", { name: "选择历史媒体样本", exact: true })).not.toBeChecked();
    await page.getByText("历史媒体样本", { exact: true }).click();
    await expect(page.getByText("此来源处于只读状态", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "开始扫描", exact: true })).toHaveCount(0);
    await page.getByRole("tab", { name: "更多设置", exact: true }).click();
    await expect(page.getByText("提交与导入", { exact: true })).toHaveCount(0);
    await page.getByRole("tab", { name: "发现的 Tweet", exact: true }).click();
    await expect(page.getByText("此来源仅可查看历史记录", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "下载", exact: true })).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

async function mockSources(page: Page) {
  const rows = [source(901, "user_media", "历史媒体样本"), source(902, "user_photos", "图片样本"), source(903, "user_videos", "视频样本")];
  const fixture = { created: null as unknown, scan: null as unknown };
  await page.routeWebSocket("**/api/v1/runtime/ws", () => {});
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const json = (body: unknown) => route.fulfill({ json: body });
    if (path === "/api/v1/auth/session") return json({ status: "authenticated", auth_mode: "password", user: { username: "fixture", media_privacy_mode: false } });
    if (path === "/api/v1/health/detail") return json({ status: "ok", worker: {}, queue: {}, sources: {}, recent_errors: [] });
    if (path === "/api/v1/events") return route.fulfill({ contentType: "text/event-stream", body: "" });
    if (path === "/api/v1/settings/download-policy") return json({ source_scan_batch_size: 20 });
    if (path === "/api/v1/sources" && request.method() === "POST") {
      fixture.created = request.postDataJSON();
      return json(rows[1]);
    }
    if (path === "/api/v1/sources") return json({ ...emptyPage, rows, count: 3, total_count: 3, selectable_count: 2 });
    const match = path.match(/^\/api\/v1\/sources\/(\d+)(.*)$/);
    if (match) {
      const row = rows.find((item) => item.id === Number(match[1]));
      if (match[2] === "") return json(row);
      if (match[2] === "/scan-sessions") {
        fixture.scan = request.postDataJSON();
        if (row) Object.assign(row, { status: "active", cursor_state: { active_scan_mode: "history", automation_enabled: true } });
        return json(row);
      }
      if (match[2] === "/downloads") return json({ source_id: row?.id, active_run: null, active_counts: {}, paused_runs: [], blocked_runs: [], recent_runs: [], pending_count: 0, processing_count: 0, paused_count: 0 });
      return json(emptyPage);
    }
    return json(emptyPage);
  });
  return fixture;
}

const emptyPage = { rows: [], count: 0, total_count: 0, limit: 50, offset: 0 };

function source(id: number, sourceType: string, label: string) {
  return {
    id, source_type: sourceType, source_url: `https://x.com/splitfixture/media${sourceType === "user_photos" ? "?filter=photo" : ""}`,
    label, author_username: "splitfixture", status: "paused", deleted_at: null,
    is_pinned: false, manual_order: 0, discovered_count: 0, discovered_tweet_count: 0,
    discovered_media_count: 0, unsubmitted_tweet_count: 0, scan_batch_count: 0,
    cursor_state: {}, active_scan_run: null, scan_summary: { batch_count: 0, added_tweet_count: 0 },
    created_at: "2026-09-08T00:00:00Z", updated_at: "2026-09-08T00:00:00Z",
  };
}
