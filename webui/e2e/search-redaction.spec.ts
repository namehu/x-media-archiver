import { expect, test, type Page, type Route } from "@playwright/test";

declare global {
  interface Window {
    __searchVideoTest: {
      advancePreviewVideo: (seconds: number) => void;
      listVideoCurrentTime: () => number | null;
      listVideoPaused: () => boolean | null;
    };
  }
}

test("search redacts the query and private organization context in debugger mode", async ({ page }) => {
  await mockSearchApis(page);

  await page.goto("/search?debugger=1&q=private");
  await expect(page.getByRole("heading", { name: "全局搜索" })).toBeVisible();
  await expect(page.getByText("私人备注内容")).toBeVisible();

  const queryField = page.getByLabel("关键词").locator("xpath=ancestor::*[@data-debug-redact][1]");
  const privateContext = page
    .locator("[data-debug-redact]")
    .filter({ hasText: "私人备注内容" });

  await expect(queryField).toHaveCount(1);
  await expect(privateContext).toHaveCount(1);
  await expect(queryField).not.toHaveCSS("filter", "none");
  await expect(privateContext).not.toHaveCSS("filter", "none");
});

test("search keeps structured refinements in one sheet", async ({ page }) => {
  await mockSearchApis(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => localStorage.setItem("x-archiver-theme", "dark"));

  await page.goto("/search?q=private");
  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect(page.getByRole("search").getByLabel("关键词")).toHaveValue("private");
  await expect(page.getByRole("combobox", { name: "选择平台 Hashtag" })).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await page.getByRole("button", { name: "筛选", exact: true }).click();
  const filterSheet = page.getByRole("dialog", { name: "筛选搜索结果" });
  await expect(filterSheet).toBeVisible();
  await expect(filterSheet.getByRole("combobox", { name: "选择平台 Hashtag" })).toBeVisible();
  await expect(filterSheet.getByLabel("关键词")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("search resumes list video after closing preview", async ({ page }) => {
  await installMediaElementMock(page);
  await mockSearchApis(page);

  await page.goto("/search?q=private");
  await expect(page.getByText("private tweet text", { exact: true })).toBeVisible();
  await page.locator('[data-feed-media="true"] video').click();
  await expect(page.getByRole("dialog")).toBeVisible();

  await page.evaluate(() => window.__searchVideoTest.advancePreviewVideo(7));
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await expect.poll(() => page.evaluate(() => window.__searchVideoTest.listVideoPaused())).toBe(false);
  await expect.poll(() => page.evaluate(() => window.__searchVideoTest.listVideoCurrentTime())).toBeGreaterThan(6.5);
});

async function mockSearchApis(page: Page) {
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/v1/auth/session") {
      return json(route, {
        status: "authenticated",
        auth_mode: "password",
        user: { username: "search-redaction-test" },
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
      return json(route, { tags: [], collections: [] });
    }
    if (url.pathname === "/api/v1/library/search") {
      return json(route, {
        rows: [
          {
            tweet_id: "search-redaction-fixture",
            tweet_url: "https://x.com/private/status/search-redaction-fixture",
            author_username: "private-author",
            author_display_name: "私人作者",
            published_at: "2026-08-12T00:30:00Z",
            tweet_text: "private tweet text",
            tweet_status: "verified",
            relevance: 1,
            tags: ["私人标签"],
            collections: ["私人合集"],
            note_excerpt: "私人备注内容",
            media: [
              {
                id: 301,
                tweet_id: "search-redaction-fixture",
                media_index: 0,
                media_type: "video",
                media_status: "verified",
                source_engine: "fixture",
                local_path: "/archive/media/private/search-redaction-fixture/0.mp4",
                media_relative_path: "media/private/search-redaction-fixture/0.mp4",
                media_url: "/api/v1/media-file/media/private/search-redaction-fixture/0.mp4",
                preview_relative_path: "media/private/search-redaction-fixture/0.jpg",
                preview_url: "data:image/gif;base64,R0lGODlhAQABAAAAACw=",
                file_size: 1024,
                width: 1280,
                height: 720,
                duration_ms: 10000,
              },
            ],
          },
        ],
        count: 1,
        total_count: 1,
        limit: 20,
        offset: 0,
      });
    }
    if (url.pathname === "/api/v1/events") {
      return route.fulfill({ status: 200, headers: { "content-type": "text/event-stream" }, body: "" });
    }
    if (url.pathname.startsWith("/api/v1/media-file/")) {
      return route.fulfill({ status: 204, body: "" });
    }
    return json(route, {}, 404);
  });
}

async function installMediaElementMock(page: Page) {
  await page.addInitScript(() => {
    type MediaState = {
      currentTime: number;
      duration: number;
      ended: boolean;
      muted: boolean;
      paused: boolean;
      playbackRate: number;
      readyState: number;
      volume: number;
    };

    const states = new WeakMap<HTMLMediaElement, MediaState>();
    const getState = (element: HTMLMediaElement) => {
      let state = states.get(element);
      if (!state) {
        state = {
          currentTime: 0,
          duration: 10,
          ended: false,
          muted: false,
          paused: true,
          playbackRate: 1,
          readyState: 0,
          volume: 1,
        };
        states.set(element, state);
      }
      return state;
    };
    const dispatch = (element: HTMLMediaElement, type: string) => {
      queueMicrotask(() => element.dispatchEvent(new Event(type)));
    };
    const ensureMetadata = (element: HTMLMediaElement) => {
      const state = getState(element);
      if (state.readyState >= 1) return;
      state.readyState = 1;
      dispatch(element, "loadedmetadata");
      dispatch(element, "durationchange");
    };
    const defineMediaProperty = <K extends keyof HTMLMediaElement>(
      name: K,
      descriptor: PropertyDescriptor,
    ) => {
      Object.defineProperty(HTMLMediaElement.prototype, name, { configurable: true, ...descriptor });
    };

    defineMediaProperty("currentTime", {
      get() {
        return getState(this).currentTime;
      },
      set(value: number) {
        const state = getState(this);
        state.currentTime = Number.isFinite(value) ? value : 0;
        state.ended = state.currentTime >= state.duration;
        dispatch(this, "seeked");
      },
    });
    defineMediaProperty("duration", { get() { return getState(this).duration; } });
    defineMediaProperty("ended", { get() { return getState(this).ended; } });
    defineMediaProperty("muted", {
      get() { return getState(this).muted; },
      set(value: boolean) {
        getState(this).muted = Boolean(value);
        dispatch(this, "volumechange");
      },
    });
    defineMediaProperty("paused", { get() { return getState(this).paused; } });
    defineMediaProperty("playbackRate", {
      get() { return getState(this).playbackRate; },
      set(value: number) {
        getState(this).playbackRate = Number.isFinite(value) && value > 0 ? value : 1;
        dispatch(this, "ratechange");
      },
    });
    defineMediaProperty("readyState", { get() { return getState(this).readyState; } });
    defineMediaProperty("volume", {
      get() { return getState(this).volume; },
      set(value: number) {
        getState(this).volume = Math.min(Math.max(Number.isFinite(value) ? value : 1, 0), 1);
        dispatch(this, "volumechange");
      },
    });

    HTMLMediaElement.prototype.load = function load() {
      ensureMetadata(this);
    };
    HTMLMediaElement.prototype.pause = function pause() {
      const state = getState(this);
      if (state.paused) return;
      state.paused = true;
      dispatch(this, "pause");
    };
    HTMLMediaElement.prototype.play = function play() {
      ensureMetadata(this);
      const state = getState(this);
      state.paused = false;
      state.ended = false;
      dispatch(this, "play");
      return Promise.resolve();
    };

    window.__searchVideoTest = {
      advancePreviewVideo(seconds: number) {
        const video = document.querySelector<HTMLVideoElement>(".art-video-player video");
        if (!video) throw new Error("Preview video was not mounted.");
        ensureMetadata(video);
        const state = getState(video);
        state.currentTime = seconds;
        state.paused = false;
        state.ended = false;
        video.dispatchEvent(new Event("timeupdate"));
      },
      listVideoCurrentTime() {
        const video = document.querySelector<HTMLVideoElement>('[data-feed-media="true"] video');
        return video ? video.currentTime : null;
      },
      listVideoPaused() {
        const video = document.querySelector<HTMLVideoElement>('[data-feed-media="true"] video');
        return video ? video.paused : null;
      },
    };
  });
}

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}
