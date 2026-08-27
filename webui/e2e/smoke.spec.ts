import { expect, test, type Page } from "@playwright/test";

const apiBaseUrl = process.env.XMA_API_BASE_URL ?? "http://127.0.0.1:18000";

const routes = [
  { path: "/", label: "首页", text: "webui-e2e fixture tweet" },
  { path: "/dashboard", label: "系统概览", text: "媒体资产" },
  {
    path: "/library",
    label: "媒体",
    imageName: "webui-e2e fixture tweet with a verified media row",
  },
  { path: "/insights", label: "洞察", text: "归档洞察" },
  { path: "/collections", label: "合集", text: "还没有合集" },
  { path: "/tags", label: "自定义标签", text: "自定义标签" },
  { path: "/failures", label: "失败工作台", text: "webui-e2e-failed" },
  { path: "/duplicates", label: "重复媒体", text: "重复媒体" },
  { path: "/queue", label: "归档队列", text: "Run #" },
  { path: "/sources", label: "来源管理", text: "webui-e2e source" },
  { path: "/operations", label: "系统操作", text: "系统状态" },
];

test.describe("WebUI smoke", () => {
  test("renders core routes against the local API", async ({ browser, page }) => {
    const initialPassword = "e2e-test-password-123";
    const alternatePassword = "e2e-updated-password-123";
    const runtimeErrors: string[] = [];
    let authSessionTransition = false;
    page.on("pageerror", (error) => runtimeErrors.push(error.message));
    page.on("console", (message) => {
      if (
        message.type() === "error" &&
        authSessionTransition &&
        message.text().includes("401 (Unauthorized)")
      ) {
        return;
      }
      if (message.type() === "error") runtimeErrors.push(message.text());
    });

    const setupToken = process.env.XMA_SETUP_TOKEN;
    let password = initialPassword;
    await page.goto("/");
    let authScreen = await waitForAuthScreen(page);
    if (authScreen === "safety") {
      await acknowledgeAdultContent(page);
      authScreen = "authenticated";
    }
    if (authScreen === "setup") {
      expect(setupToken, "XMA_SETUP_TOKEN is required for a fresh auth database").toBeTruthy();
      await page.getByLabel("一次性设置令牌").fill(setupToken!);
      await page.getByLabel("用户名").fill("e2e-admin");
      await page.getByLabel("密码", { exact: true }).fill(password);
      await page.getByLabel("确认密码").fill(password);
      await page.getByRole("button", { name: "创建管理员" }).click();
      await acknowledgeAdultContent(page);
      await expect(page.getByRole("link", { name: "系统概览" })).toBeVisible();
      await page.reload();
      authScreen = await waitForAuthScreen(page);
    }
    if (authScreen === "login") {
      authSessionTransition = true;
      try {
        if (!(await signIn(page, initialPassword))) {
          expect(await signIn(page, alternatePassword), "E2E administrator password is unavailable").toBeTruthy();
          password = alternatePassword;
        }
      } finally {
        authSessionTransition = false;
      }
    }
    await expect(page.getByRole("link", { name: "系统概览" })).toBeVisible();

    for (const route of routes) {
      await page.goto(route.path);
      await expect(page.getByRole("link", { name: route.label, exact: true })).toBeVisible();
      if ("imageName" in route) {
        await expect(page.getByRole("img", { name: route.imageName })).toBeVisible();
      } else {
        await expect(page.getByText(route.text).first()).toBeVisible();
      }
    }
    await page.getByRole("tab", { name: "Cookies" }).click();
    await expect(page.getByRole("button", { name: "检测 Cookies" })).toBeVisible();

    await page.route("**/api/v1/library/tweets/webui-e2e-verified", async (route) => {
      const response = await route.fetch();
      const detail = await response.json();
      detail.media[0].media_type = "video";
      await route.fulfill({ response, json: detail });
    });
    await page.goto("/tweets/webui-e2e-verified");
    await expect(page.locator(".tweet-video-player .art-video-player")).toBeVisible();
    await page.locator(".art-icon-fullscreenWebOn").locator("..").click();
    await expect(page.locator("body > .art-video-player.art-fullscreen-web")).toHaveCount(1);
    await page.goBack();
    await expect(page).toHaveURL(/\/tweets\/webui-e2e-verified$/);
    await expect(page.locator("body > .art-video-player.art-fullscreen-web")).toHaveCount(0);
    await page.goForward();
    await expect(page.locator("body > .art-video-player.art-fullscreen-web")).toHaveCount(1);
    await page.goBack();
    await expect(page.locator("body > .art-video-player.art-fullscreen-web")).toHaveCount(0);
    await page.goBack();
    await expect(page.getByRole("link", { name: "系统操作" })).toBeVisible();
    await expect(page.locator("body > .art-video-player.art-fullscreen-web")).toHaveCount(0);

    await page.getByRole("button", { name: "账户菜单" }).click();
    authSessionTransition = true;
    await page.getByRole("menuitem", { name: "退出登录" }).click();
    await expect(page.getByRole("heading", { name: "欢迎回来" })).toBeVisible();
    expect(await signIn(page, password)).toBeTruthy();

    const oldSessionCookies = await page.context().cookies();
    await page.getByRole("button", { name: "账户菜单" }).click();
    await page.getByRole("menuitem", { name: "修改密码" }).click();
    const nextPassword = password === initialPassword ? alternatePassword : initialPassword;
    await page.getByLabel("当前密码").fill(password);
    await page.getByLabel("新密码").fill(nextPassword);
    await page.getByLabel("确认密码").fill(nextPassword);
    await page.getByRole("button", { name: "修改密码" }).click();
    await expect(page.getByText("密码已修改")).toBeVisible();

    const staleContext = await browser.newContext();
    await staleContext.addCookies(oldSessionCookies);
    const staleSession = await staleContext.request.get(`${apiBaseUrl}/api/v1/auth/session`);
    expect(await staleSession.json()).toMatchObject({ status: "anonymous", user: null });
    await staleContext.close();

    expect(runtimeErrors).toEqual([]);
  });
});

async function waitForAuthScreen(page: Page): Promise<"authenticated" | "login" | "setup" | "safety"> {
  let authScreen: "authenticated" | "login" | "setup" | "safety" | null = null;
  await expect
    .poll(
      async () => {
        if (await page.getByRole("link", { name: "系统概览" }).isVisible()) authScreen = "authenticated";
        else if (await page.getByRole("heading", { name: "成人内容提示" }).isVisible()) authScreen = "safety";
        else if (await page.getByRole("heading", { name: "初始化管理员" }).isVisible()) authScreen = "setup";
        else if (await page.getByRole("heading", { name: "欢迎回来" }).isVisible()) authScreen = "login";
        return authScreen !== null;
      },
      { timeout: 10_000 },
    )
    .toBe(true);
  return authScreen!;
}

async function signIn(page: Page, password: string) {
  await page.getByLabel("用户名").fill("e2e-admin");
  await page.getByLabel("密码").fill(password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  try {
    await expect
      .poll(
        async () =>
          (await page.getByRole("link", { name: "系统概览" }).isVisible()) ||
          (await page.getByRole("heading", { name: "成人内容提示" }).isVisible()),
        { timeout: 3_000 },
      )
      .toBe(true);
    if (await page.getByRole("heading", { name: "成人内容提示" }).isVisible()) {
      await acknowledgeAdultContent(page);
    }
    await page.getByRole("link", { name: "系统概览" }).waitFor({ state: "visible", timeout: 3_000 });
    return true;
  } catch {
    return false;
  }
}

async function acknowledgeAdultContent(page: Page) {
  await page.getByRole("button", { name: "我已年满 18 岁，查看原始内容" }).click();
  await page.getByRole("link", { name: "系统概览" }).waitFor({ state: "visible" });
}
