import { expect, test, type Page } from "@playwright/test";

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
  test("renders core routes against the local API", async ({ browser, page }) => {
    const initialPassword = "e2e-test-password-123";
    const alternatePassword = "e2e-updated-password-123";
    const runtimeErrors: string[] = [];
    page.on("pageerror", (error) => runtimeErrors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") runtimeErrors.push(message.text());
    });

    const setupToken = process.env.XMA_SETUP_TOKEN;
    let password = initialPassword;
    let initializedAdmin = false;
    await page.goto("/");
    if (await page.getByRole("heading", { name: "初始化管理员" }).isVisible()) {
      expect(setupToken, "XMA_SETUP_TOKEN is required for a fresh auth database").toBeTruthy();
      await page.getByLabel("一次性设置令牌").fill(setupToken!);
      await page.getByLabel("用户名").fill("e2e-admin");
      await page.getByLabel("密码", { exact: true }).fill(password);
      await page.getByLabel("确认密码").fill(password);
      await page.getByRole("button", { name: "创建管理员" }).click();
      await expect(page.getByRole("link", { name: "仪表盘" })).toBeVisible();
      initializedAdmin = true;
      await page.reload();
    }
    if (await page.getByRole("heading", { name: "登录 x-media-archiver" }).isVisible()) {
      if (initializedAdmin) {
        await expect(page.getByRole("link", { name: "仪表盘" })).toBeVisible();
      } else if (!(await signIn(page, initialPassword))) {
        expect(await signIn(page, alternatePassword), "E2E administrator password is unavailable").toBeTruthy();
        password = alternatePassword;
      }
    }
    await expect(page.getByRole("link", { name: "仪表盘" })).toBeVisible();

    for (const route of routes) {
      await page.goto(route.path);
      await expect(page.getByRole("link", { name: route.label })).toBeVisible();
      await expect(page.getByText(route.text).first()).toBeVisible();
    }

    await page.getByRole("button", { name: "e2e-admin" }).click();
    await page.getByRole("menuitem", { name: "退出登录" }).click();
    await expect(page.getByRole("heading", { name: "登录 x-media-archiver" })).toBeVisible();
    await page.getByLabel("用户名").fill("e2e-admin");
    await page.getByLabel("密码").fill(password);
    await page.getByRole("button", { name: "登录" }).click();
    await expect(page.getByRole("link", { name: "仪表盘" })).toBeVisible();

    const oldSessionCookies = await page.context().cookies();
    await page.getByRole("button", { name: "e2e-admin" }).click();
    await page.getByRole("menuitem", { name: "修改密码" }).click();
    const nextPassword = password === initialPassword ? alternatePassword : initialPassword;
    await page.getByLabel("当前密码").fill(password);
    await page.getByLabel("新密码").fill(nextPassword);
    await page.getByLabel("确认密码").fill(nextPassword);
    await page.getByRole("button", { name: "修改密码" }).click();
    await expect(page.getByText("密码已修改")).toBeVisible();

    const staleContext = await browser.newContext();
    await staleContext.addCookies(oldSessionCookies);
    const staleSession = await staleContext.request.get("http://127.0.0.1:18000/api/v1/auth/session");
    expect(await staleSession.json()).toMatchObject({ status: "anonymous", user: null });
    await staleContext.close();

    expect(runtimeErrors).toEqual([]);
  });
});

async function signIn(page: Page, password: string) {
  await page.getByLabel("用户名").fill("e2e-admin");
  await page.getByLabel("密码").fill(password);
  await page.getByRole("button", { name: "登录" }).click();
  try {
    await page.getByRole("link", { name: "仪表盘" }).waitFor({ state: "visible", timeout: 3_000 });
    return true;
  } catch {
    return false;
  }
}
