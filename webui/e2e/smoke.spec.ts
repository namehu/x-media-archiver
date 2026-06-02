import { expect, test } from "@playwright/test";

const routes = [
  { path: "/", label: "仪表盘", text: "媒体文件" },
  { path: "/library", label: "媒体库", text: "webui-e2e fixture tweet" },
  { path: "/failures", label: "失败项", text: "webui-e2e-failed" },
  { path: "/duplicates", label: "重复媒体", text: "重复媒体" },
  { path: "/queue", label: "归档队列", text: "Run #" },
  { path: "/sources", label: "来源", text: "webui-e2e source" },
  { path: "/operations", label: "操作", text: "系统状态" },
];

test.describe("WebUI smoke", () => {
  test("renders core routes against the local API", async ({ page }) => {
    const runtimeErrors: string[] = [];
    page.on("pageerror", (error) => runtimeErrors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") runtimeErrors.push(message.text());
    });

    for (const route of routes) {
      await page.goto(route.path);
      await expect(page.getByRole("link", { name: route.label })).toBeVisible();
      await expect(page.getByText(route.text).first()).toBeVisible();
    }

    expect(runtimeErrors).toEqual([]);
  });
});
