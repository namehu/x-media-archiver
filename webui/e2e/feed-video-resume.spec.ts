import { expect, test, type Page, type Route } from "@playwright/test";

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => sessionStorage.setItem("xma:webui:adult-content-acknowledged", "1"));
});

declare global {
  interface Window {
    __feedVideoTest: {
      advancePreviewVideo: (seconds: number) => void;
      listVideoCurrentTime: () => number | null;
      listVideoPaused: () => boolean | null;
    };
  }
}

test.describe("Feed video resume", () => {
  test("resumes the feed video from the preview playback position", async ({ page }) => {
    await installMediaElementMock(page);
    await mockFeedApis(page);

    await page.goto("/feed");
    await expect(page.getByText("feed video resume fixture", { exact: true })).toBeVisible();

    await page.locator('[data-feed-media="true"] video').click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.locator(".art-video-player video")).toHaveCount(1);
    const fullWebPlayer = page.locator("body > .art-video-player.art-fullscreen-web");
    await expect(fullWebPlayer).toBeVisible();
    await expect(fullWebPlayer.locator(".art-layer-feed-preview-overlay")).toBeVisible();
    await expect(fullWebPlayer.getByText("示例作者", { exact: true })).toBeVisible();
    await expect(fullWebPlayer.getByText("@example", { exact: true })).toBeVisible();
    await expect(fullWebPlayer.getByRole("button", { name: "关闭预览" })).toBeVisible();

    await page.evaluate(() => window.__feedVideoTest.advancePreviewVideo(7));
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);

    await expect.poll(() => page.evaluate(() => window.__feedVideoTest.listVideoPaused())).toBe(false);
    await expect.poll(() => page.evaluate(() => window.__feedVideoTest.listVideoCurrentTime())).toBeGreaterThan(6.5);
    expect(await page.evaluate(() => window.__feedVideoTest.listVideoCurrentTime())).toBeLessThan(7.5);
  });

  test("keeps preview information inside the fullWeb player on narrow screens", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "userAgent", {
        configurable: true,
        get: () =>
          "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1",
      });
    });
    await installMediaElementMock(page);
    await mockFeedApis(page);

    await page.goto("/feed");
    await page.locator('[data-feed-media="true"] video').click();

    const fullWebPlayer = page.locator("body > .art-video-player.art-fullscreen-web");
    await expect(fullWebPlayer.locator(".art-layer-feed-preview-overlay")).toBeVisible();
    await expect(fullWebPlayer.getByText("示例作者", { exact: true })).toBeVisible();
    await expect(fullWebPlayer.getByText("feed video resume fixture", { exact: true })).toBeVisible();

    const closeButton = fullWebPlayer.getByRole("button", { name: "关闭预览" });
    await expect(closeButton).toBeVisible();

    const previewChrome = fullWebPlayer.locator('[data-preview-chrome="true"]');
    const video = fullWebPlayer.locator("video");
    const bottomControls = fullWebPlayer.locator(".art-bottom");

    await fullWebPlayer.evaluate((element) => {
      element.classList.remove("art-control-show", "art-hover");
    });
    await expect(previewChrome).toHaveClass(/opacity-0/);
    await expect(bottomControls).toHaveCSS("opacity", "0");

    // Click through the area previously occupied by the now-transparent header.
    await video.click({ position: { x: 120, y: 100 } });
    await expect(previewChrome).toHaveClass(/opacity-100/);
    await expect(bottomControls).toHaveCSS("opacity", "1");
  });
});

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
      Object.defineProperty(HTMLMediaElement.prototype, name, {
        configurable: true,
        ...descriptor,
      });
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
    defineMediaProperty("duration", {
      get() {
        return getState(this).duration;
      },
    });
    defineMediaProperty("ended", {
      get() {
        return getState(this).ended;
      },
    });
    defineMediaProperty("muted", {
      get() {
        return getState(this).muted;
      },
      set(value: boolean) {
        getState(this).muted = Boolean(value);
        dispatch(this, "volumechange");
      },
    });
    defineMediaProperty("paused", {
      get() {
        return getState(this).paused;
      },
    });
    defineMediaProperty("playbackRate", {
      get() {
        return getState(this).playbackRate;
      },
      set(value: number) {
        getState(this).playbackRate = Number.isFinite(value) && value > 0 ? value : 1;
        dispatch(this, "ratechange");
      },
    });
    defineMediaProperty("readyState", {
      get() {
        return getState(this).readyState;
      },
    });
    defineMediaProperty("volume", {
      get() {
        return getState(this).volume;
      },
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

    window.__feedVideoTest = {
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

async function mockFeedApis(page: Page) {
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;

    if (path === "/api/v1/auth/session") {
      return json(route, {
        status: "authenticated",
        auth_mode: "password",
        user: { username: "feed-video-test", media_privacy_mode: false },
      });
    }
    if (path === "/api/v1/health/detail") return json(route, healthDetail());
    if (path === "/api/v1/events") {
      return route.fulfill({ status: 200, headers: { "content-type": "text/event-stream" }, body: "" });
    }
    if (path === "/api/v1/sources" && request.method() === "GET") {
      return json(route, { rows: [], count: 0, total_count: 0, limit: 200, offset: 0 });
    }
    if (path === "/api/v1/library/posts" && request.method() === "GET") {
      return json(route, { rows: [feedPost()], count: 1, total_count: 1, limit: 20, offset: 0 });
    }
    if (path.startsWith("/api/v1/media-file/")) {
      return route.fulfill({ status: 204, body: "" });
    }

    return route.fulfill({ status: 404, json: { error: `Unhandled test route: ${path}` } });
  });
}

function feedPost() {
  return {
    tweet_id: "feed-video-resume",
    tweet_url: "https://x.com/example/status/feed-video-resume",
    author_username: "example",
    author_display_name: "示例作者",
    published_at: "2026-01-01T00:00:00Z",
    tweet_text: "feed video resume fixture",
    tweet_status: "verified",
    media: [
      {
        id: 101,
        tweet_id: "feed-video-resume",
        media_index: 0,
        media_type: "video",
        media_status: "verified",
        source_engine: "fixture",
        local_path: "/archive/media/example/feed-video-resume/0.mp4",
        media_relative_path: "media/example/feed-video-resume/0.mp4",
        media_url: "/api/v1/media-file/media/example/feed-video-resume/0.mp4",
        preview_relative_path: "media/example/feed-video-resume/0.jpg",
        preview_url: "data:image/gif;base64,R0lGODlhAQABAAAAACw=",
        file_size: 1024,
        width: 1280,
        height: 720,
        duration_ms: 10000,
      },
    ],
  };
}

function healthDetail() {
  return {
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
  };
}

function json(route: Route, value: unknown) {
  return route.fulfill({ json: value });
}
