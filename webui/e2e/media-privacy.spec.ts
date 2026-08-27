import { expect, test, type BrowserContext, type Route } from "@playwright/test";

type AuthState = {
  mediaPrivacyMode: boolean;
  authenticated?: boolean;
  authMode?: "password" | "disabled";
  failPreferenceUpdate?: boolean;
  mediaRequests: number;
  contentRequests: number;
};

const TAB_ACKNOWLEDGEMENT_KEY = "xma:webui:adult-content-acknowledged";

test("global gate blocks route mounting and remembers acknowledgement only in the current tab", async ({
  context,
  page,
}) => {
  const state: AuthState = {
    mediaPrivacyMode: false,
    mediaRequests: 0,
    contentRequests: 0,
  };
  await mockPrivacyApis(context, state);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => localStorage.setItem("x-archiver-theme", "dark"));

  await page.goto("/tweets/privacy-fixture");
  await expect(page.getByRole("heading", { name: "成人内容提示" })).toBeVisible();
  await expect(page.getByRole("button", { name: "我已年满 18 岁，查看原始内容" })).toBeFocused();
  expect(state.contentRequests).toBe(0);
  expect(state.mediaRequests).toBe(0);
  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await page.getByRole("button", { name: "我已年满 18 岁，查看原始内容" }).click();
  await expect(page.getByRole("heading", { name: "成人内容提示" })).toHaveCount(0);
  await expect(page.locator("h1").filter({ hasText: "Tweet" })).toBeVisible();
  expect(state.contentRequests).toBe(1);
  await expect.poll(() => page.evaluate((key) => sessionStorage.getItem(key), TAB_ACKNOWLEDGEMENT_KEY)).toBe("1");

  await page.reload();
  await expect(page.locator("h1").filter({ hasText: "Tweet" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "成人内容提示" })).toHaveCount(0);

  const secondPage = await context.newPage();
  await secondPage.goto("/tweets/privacy-fixture");
  await expect(secondPage.getByRole("heading", { name: "成人内容提示" })).toBeVisible();
  await expect(secondPage.locator("h1").filter({ hasText: "Tweet" })).toHaveCount(0);
  await expect.poll(() => secondPage.evaluate((key) => sessionStorage.getItem(key), TAB_ACKNOWLEDGEMENT_KEY)).toBeNull();
});

test("gate can persist privacy mode and enter a request-free hidden detail view", async ({ context, page }) => {
  const state: AuthState = {
    mediaPrivacyMode: false,
    failPreferenceUpdate: true,
    mediaRequests: 0,
    contentRequests: 0,
  };
  await mockPrivacyApis(context, state);

  await page.goto("/tweets/privacy-fixture");
  await page.getByRole("button", { name: "开启隐私模式后继续" }).click();
  await expect(page.getByRole("heading", { name: "成人内容提示" })).toBeVisible();
  await expect(page.getByText("操作未完成，内容仍保持隐藏。请检查网络后重试。")).toBeVisible();
  expect(state.contentRequests).toBe(0);

  state.failPreferenceUpdate = false;
  await page.getByRole("button", { name: "开启隐私模式后继续" }).click();

  await expect(page.locator("h1").filter({ hasText: "Tweet" })).toBeVisible();
  await expect(page.getByText("媒体已隐藏", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "在 X 中查看" })).toHaveCount(0);
  await expect(page.locator("img, video")).toHaveCount(0);
  expect(state.mediaPrivacyMode).toBe(true);
  expect(state.mediaRequests).toBe(0);
  await expect(page.locator("html")).not.toHaveClass(/dark/);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await page.reload();
  await expect(page.getByRole("heading", { name: "成人内容提示" })).toHaveCount(0);
  await expect(page.getByText("媒体已隐藏", { exact: true })).toBeVisible();
  expect(state.mediaRequests).toBe(0);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("button", { name: "关闭媒体隐私模式" })).toBeHidden();
  await page.getByRole("button", { name: "账户菜单" }).click();
  await expect(page.getByRole("menuitem").filter({ hasText: "媒体隐私模式" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("turning privacy off requires confirmation and never reveals media when saving fails", async ({
  context,
  page,
}) => {
  const state: AuthState = {
    mediaPrivacyMode: true,
    failPreferenceUpdate: true,
    mediaRequests: 0,
    contentRequests: 0,
  };
  await mockPrivacyApis(context, state);

  await page.goto("/tweets/privacy-fixture");
  await expect(page.getByText("媒体已隐藏", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "关闭媒体隐私模式" }).click();
  await expect(page.getByRole("dialog", { name: "关闭媒体隐私模式？" })).toBeVisible();
  await page.getByRole("button", { name: "取消" }).click();
  await expect(page.getByText("媒体已隐藏", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "关闭媒体隐私模式" }).click();
  await page.getByRole("button", { name: "我已年满 18 岁，关闭隐私模式" }).click();
  await expect(page.getByText("未能关闭隐私模式，内容仍保持隐藏。")).toBeVisible();
  await expect(page.getByText("媒体已隐藏", { exact: true })).toBeVisible();
  await expect(page.locator("img, video")).toHaveCount(0);
  expect(state.mediaRequests).toBe(0);
  await expect.poll(() => page.evaluate((key) => sessionStorage.getItem(key), TAB_ACKNOWLEDGEMENT_KEY)).toBeNull();

  state.failPreferenceUpdate = false;
  await page.getByRole("button", { name: "我已年满 18 岁，关闭隐私模式" }).click();
  await expect(page.getByText("媒体已隐藏", { exact: true })).toHaveCount(0);
  await expect.poll(() => page.evaluate((key) => sessionStorage.getItem(key), TAB_ACKNOWLEDGEMENT_KEY)).toBe("1");
  expect(state.mediaPrivacyMode).toBe(false);
});

test("logout clears tab acknowledgement and the next login shows the gate again", async ({ context, page }) => {
  const state: AuthState = {
    mediaPrivacyMode: false,
    mediaRequests: 0,
    contentRequests: 0,
  };
  await mockPrivacyApis(context, state);

  await page.goto("/tweets/privacy-fixture");
  await page.getByRole("button", { name: "我已年满 18 岁，查看原始内容" }).click();
  await page.getByRole("button", { name: "账户菜单" }).click();
  await page.getByRole("menuitem", { name: "退出登录" }).click();

  await expect(page.getByRole("heading", { name: "欢迎回来" })).toBeVisible();
  await expect.poll(() => page.evaluate((key) => sessionStorage.getItem(key), TAB_ACKNOWLEDGEMENT_KEY)).toBeNull();

  await page.getByLabel("用户名").fill("privacy-test");
  await page.getByLabel("密码").fill("long-enough-password");
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page.getByRole("heading", { name: "成人内容提示" })).toBeVisible();
});

test("authentication expiry clears the current tab acknowledgement", async ({ context, page }) => {
  const state: AuthState = {
    mediaPrivacyMode: false,
    mediaRequests: 0,
    contentRequests: 0,
  };
  await mockPrivacyApis(context, state);

  await page.goto("/tweets/privacy-fixture");
  await page.getByRole("button", { name: "我已年满 18 岁，查看原始内容" }).click();
  await expect.poll(() => page.evaluate((key) => sessionStorage.getItem(key), TAB_ACKNOWLEDGEMENT_KEY)).toBe("1");

  await page.evaluate(() => window.dispatchEvent(new Event("xma:unauthorized")));
  await expect(page.getByRole("heading", { name: "欢迎回来" })).toBeVisible();
  await expect.poll(() => page.evaluate((key) => sessionStorage.getItem(key), TAB_ACKNOWLEDGEMENT_KEY)).toBeNull();
});

test("disabled auth mode keeps privacy locally and acknowledgement in the current tab", async ({ context, page }) => {
  const state: AuthState = {
    mediaPrivacyMode: false,
    authMode: "disabled",
    mediaRequests: 0,
    contentRequests: 0,
  };
  await mockPrivacyApis(context, state);

  await page.goto("/tweets/privacy-fixture");
  await expect(page.getByRole("heading", { name: "成人内容提示" })).toBeVisible();
  await page.getByRole("button", { name: "我已年满 18 岁，查看原始内容" }).click();
  await expect.poll(() => page.evaluate((key) => sessionStorage.getItem(key), TAB_ACKNOWLEDGEMENT_KEY)).toBe("1");
  await page.reload();
  await expect(page.getByRole("heading", { name: "成人内容提示" })).toHaveCount(0);

  const privacyPage = await context.newPage();
  await privacyPage.goto("/tweets/privacy-fixture");
  await expect(privacyPage.getByRole("heading", { name: "成人内容提示" })).toBeVisible();
  await privacyPage.getByRole("button", { name: "开启隐私模式后继续" }).click();
  await expect(privacyPage.getByText("媒体已隐藏", { exact: true })).toBeVisible();
  await expect.poll(() => privacyPage.evaluate(() => localStorage.getItem("xma:webui:media-privacy-mode"))).toBe("1");
  await expect.poll(() => privacyPage.evaluate((key) => sessionStorage.getItem(key), TAB_ACKNOWLEDGEMENT_KEY)).toBeNull();
});

async function mockPrivacyApis(context: BrowserContext, state: AuthState) {
  await context.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());

    if (url.pathname === "/api/v1/auth/session") return authResponse(route, state);
    if (url.pathname === "/api/v1/auth/login") {
      state.authenticated = true;
      return authResponse(route, state);
    }
    if (url.pathname === "/api/v1/auth/logout") {
      state.authenticated = false;
      return route.fulfill({ status: 204 });
    }
    if (url.pathname === "/api/v1/auth/preferences") {
      if (state.failPreferenceUpdate) return json(route, { detail: "fixture failure" }, 500);
      const body = request.postDataJSON() as { media_privacy_mode: boolean };
      state.mediaPrivacyMode = body.media_privacy_mode;
      return authResponse(route, state);
    }
    if (url.pathname === "/api/v1/library/tweets/privacy-fixture") {
      state.contentRequests += 1;
      return json(route, tweetDetailFixture());
    }
    if (url.pathname.startsWith("/api/v1/media-file/")) {
      state.mediaRequests += 1;
      return route.fulfill({ status: 204 });
    }
    if (url.pathname === "/api/v1/runtime/snapshot") return json(route, runtimeSnapshot());
    return json(route, {}, 404);
  });
}

function authResponse(route: Route, state: AuthState) {
  if (state.authenticated === false) {
    return json(route, {
      status: "anonymous",
      auth_mode: state.authMode ?? "password",
      user: null,
    });
  }
  return json(route, {
    status: "authenticated",
    auth_mode: state.authMode ?? "password",
    user: {
      username: "privacy-test",
      media_privacy_mode: state.mediaPrivacyMode,
    },
  });
}

function tweetDetailFixture() {
  const media = {
    id: 801,
    tweet_id: "privacy-fixture",
    media_index: 0,
    media_type: "photo",
    media_status: "verified",
    source_engine: "fixture",
    local_path: "/archive/media/private/privacy-fixture/image.jpg",
    media_relative_path: "media/private/privacy-fixture/image.jpg",
    media_url: "/api/v1/media-file/media/private/privacy-fixture/image.jpg",
    preview_relative_path: null,
    preview_url: null,
    file_size: 1024,
    width: 1200,
    height: 800,
    duration_ms: null,
  };
  return {
    tweet: {
      ...media,
      tweet_url: "https://x.com/private/status/privacy-fixture",
      author_username: "private-author",
      author_display_name: "私密作者",
      published_at: "2026-08-27T00:00:00Z",
      tweet_text: "隐私测试正文",
      tweet_status: "verified",
      imported_at: "2026-08-27T00:00:00Z",
      updated_at: "2026-08-27T00:00:00Z",
    },
    hashtags: ["private"],
    media: [media],
    attempts: [],
    organization: {
      tweet_id: "privacy-fixture",
      tags: [],
      collections: [],
      note: null,
    },
  };
}

function runtimeSnapshot() {
  return {
    epoch: "privacy-test",
    sequence: 1,
    recent_window_seconds: 120,
    worker: { stop_requested: false, write_lock_held: false },
    queue: {},
    sources: [],
    global: {
      active_run_count: 0,
      active_item_count: 0,
      active_scan_count: 0,
      downloaded_bytes: 0,
      total_bytes: null,
      speed_bps: null,
    },
    runs: [],
    items: [],
    scans: [],
    recent_activity: [],
  };
}

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}
