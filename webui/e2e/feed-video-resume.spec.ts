import { expect, test, type Page, type Route, type WebSocketRoute } from "@playwright/test";

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => sessionStorage.setItem("xma:webui:adult-content-acknowledged", "1"));
});

declare global {
  interface Window {
    __feedVideoTest: {
      advancePreviewVideo: (seconds: number) => void;
      listVideoCurrentTime: () => number | null;
      listVideoPaused: () => boolean | null;
      rememberPreviewVideo: () => void;
      previewVideoIsStable: () => boolean;
    };
  }
}

test.describe("Feed video resume", () => {
  test("keeps a seeded random timeline in the URL and navigates posts without adding history entries", async ({ page }) => {
    const posts = [
      feedImagePost("random-one", "随机帖子一"),
      feedImagePost("random-two", "随机帖子二"),
      feedImagePost("random-three", "随机帖子三"),
      feedImagePost("random-four", "随机帖子四"),
    ];
    const postsRequest = page.waitForRequest((request) => new URL(request.url()).pathname === "/api/v1/library/posts");
    await mockFeedApis(page, posts);

    await page.goto("/feed?sort=random&seed=stable-seed&text=%E9%9A%8F%E6%9C%BA");
    const requestUrl = new URL((await postsRequest).url());
    expect(requestUrl.searchParams.get("sort")).toBe("random");
    expect(requestUrl.searchParams.get("seed")).toBe("stable-seed");
    expect(requestUrl.searchParams.get("text")).toBe("随机");

    await page.getByRole("button", { name: "重置筛选" }).click();
    await expect(page).toHaveURL(/sort=random/);
    await expect(page).toHaveURL(/seed=stable-seed/);
    expect(new URL(page.url()).searchParams.has("text")).toBe(false);

    const firstPost = page.locator("article").filter({ hasText: "随机帖子一" });
    await firstPost.getByRole("button", { name: "预览第 1 个媒体" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("随机帖子一", { exact: true })).toBeVisible();

    await page.keyboard.press("j");
    await expect(dialog.getByText("随机帖子二", { exact: true })).toBeVisible();
    await dialog.getByRole("button", { name: "上一条帖子（K）" }).click();
    await expect(dialog.getByText("随机帖子一", { exact: true })).toBeVisible();

    const surface = dialog.locator('[data-preview-tweet-surface="true"]');
    await surface.dispatchEvent("pointerdown", {
      pointerId: 9,
      pointerType: "touch",
      button: 0,
      clientX: 240,
      clientY: 620,
    });
    await surface.dispatchEvent("pointermove", {
      pointerId: 9,
      pointerType: "touch",
      button: 0,
      clientX: 240,
      clientY: 430,
    });
    await surface.dispatchEvent("pointerup", {
      pointerId: 9,
      pointerType: "touch",
      button: 0,
      clientX: 240,
      clientY: 430,
    });
    await expect(dialog.getByText("随机帖子二", { exact: true })).toBeVisible();

    for (let index = 0; index < 7; index += 1) {
      await surface.dispatchEvent("wheel", { deltaX: 0, deltaY: 80 });
      await page.waitForTimeout(100);
    }
    await expect(dialog.getByText("随机帖子三", { exact: true })).toBeVisible();
    await expect(dialog.getByText("随机帖子四", { exact: true })).toHaveCount(0);

    await page.waitForTimeout(200);
    await surface.dispatchEvent("wheel", { deltaX: 0, deltaY: 80 });
    await expect(dialog.getByText("随机帖子四", { exact: true })).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(page).toHaveURL(/sort=random/);
    await expect(page).toHaveURL(/seed=stable-seed/);

    const oldSeed = new URL(page.url()).searchParams.get("seed");
    await page.getByRole("button", { name: "重新随机", exact: true }).first().click();
    await expect.poll(() => new URL(page.url()).searchParams.get("seed")).not.toBe(oldSeed);
  });

  test("keeps the opened preview order stable across a first-page refetch", async ({ page }) => {
    const runtime = await installRuntimeSocket(page);
    let posts = [feedImagePost("snapshot-one", "快照帖子一"), feedImagePost("snapshot-two", "快照帖子二")];
    await mockFeedApis(page, () => posts);

    await page.goto("/feed");
    await page
      .locator("article")
      .filter({ hasText: "快照帖子一" })
      .getByRole("button", { name: "预览第 1 个媒体" })
      .click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("快照帖子一", { exact: true })).toBeVisible();

    posts = [
      feedImagePost("new-first-page-post", "刷新后新首屏帖子"),
      feedImagePost("snapshot-one", "快照帖子一（已更新）"),
      feedImagePost("snapshot-two", "快照帖子二"),
    ];
    const socket = await runtime.socket();
    socket.send(
      JSON.stringify(
        runtimeEnvelope("runtime.invalidate", 11, 2, {
          events: [{ topic: "library", event_type: "library.metadata_updated", payload: {} }],
        }),
      ),
    );

    await expect(dialog.getByText("快照帖子一（已更新）", { exact: true })).toBeVisible();
    await page.keyboard.press("j");
    await expect(dialog.getByText("快照帖子二", { exact: true })).toBeVisible();
    await expect(dialog.getByText("刷新后新首屏帖子", { exact: true })).toHaveCount(0);
  });

  test("removes media-empty preview items, chooses a neighbor, and closes the sole history entry", async ({ page }) => {
    const runtime = await installRuntimeSocket(page);
    await mockFeedApis(page, [
      feedImagePost("deleted-preview-one", "待删除预览一"),
      feedImagePost("deleted-preview-two", "待删除预览二"),
    ]);

    await page.goto("/feed");
    await page
      .locator("article")
      .filter({ hasText: "待删除预览一" })
      .getByRole("button", { name: "预览第 1 个媒体" })
      .click();
    const dialog = page.getByRole("dialog");
    const socket = await runtime.socket();

    socket.send(
      JSON.stringify(
        runtimeEnvelope("runtime.invalidate", 11, 2, {
          events: [
            {
              topic: "library",
              event_type: "library.media_deleted",
              payload: { tweet_ids: ["deleted-preview-one"] },
            },
          ],
        }),
      ),
    );
    await expect(dialog.getByText("待删除预览二", { exact: true })).toBeVisible();

    socket.send(
      JSON.stringify(
        runtimeEnvelope("runtime.invalidate", 12, 3, {
          events: [
            {
              topic: "library",
              event_type: "library.media_deleted",
              payload: { tweet_ids: ["deleted-preview-two"] },
            },
          ],
        }),
      ),
    );
    await expect(dialog).toHaveCount(0);
    await expect
      .poll(() => page.evaluate(() => history.state?.usr?.__dialog_history__ ?? null))
      .toBeNull();
  });

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

  test("keeps one preview player across history and prefetch state updates", async ({ page }) => {
    const runtime = await installRuntimeSocket(page);
    let exposeNextPage = false;
    let nextPageRequestCount = 0;
    let releaseNextPage!: () => void;
    const nextPageGate = new Promise<void>((resolve) => {
      releaseNextPage = resolve;
    });
    await installMediaElementMock(page);
    await mockFeedApis(page, [feedPost(), feedImagePost("prefetched-post", "预取帖子")], {
      pageSize: 1,
      totalCount: () => (exposeNextPage ? 2 : 1),
      waitForOffset: async (offset) => {
        if (offset === 0) return;
        nextPageRequestCount += 1;
        await nextPageGate;
      },
    });

    await page.goto("/feed");
    await page.locator('[data-feed-media="true"] video').click();
    const dialog = page.getByRole("dialog");
    const fullWebPlayer = page.locator("body > .art-video-player.art-fullscreen-web");
    await expect(fullWebPlayer.locator("video")).toHaveCount(1);
    await page.evaluate(() => window.__feedVideoTest.rememberPreviewVideo());

    await page.evaluate(() => {
      const current = history.state as { usr?: Record<string, unknown> } | null;
      const next = {
        ...current,
        usr: { ...current?.usr, __player_stability_marker__: Date.now() },
      };
      history.replaceState(next, "", location.href);
      window.dispatchEvent(new PopStateEvent("popstate", { state: next }));
    });
    await expect(dialog).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.__feedVideoTest.previewVideoIsStable())).toBe(true);
    await expect(fullWebPlayer.locator("video")).toHaveCount(1);

    exposeNextPage = true;
    const socket = await runtime.socket();
    socket.send(
      JSON.stringify(
        runtimeEnvelope("runtime.invalidate", 11, 2, {
          events: [{ topic: "library", event_type: "library.metadata_updated", payload: {} }],
        }),
      ),
    );
    let stableWhileFetching = false;
    try {
      await expect.poll(() => nextPageRequestCount).toBe(1);
      stableWhileFetching = await page.evaluate(() => window.__feedVideoTest.previewVideoIsStable());
    } finally {
      releaseNextPage();
    }
    expect(stableWhileFetching).toBe(true);
    await expect(fullWebPlayer.locator("video")).toHaveCount(1);

    await expect(fullWebPlayer.getByText("1/2", { exact: true })).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.__feedVideoTest.previewVideoIsStable())).toBe(true);
    await expect(fullWebPlayer.locator("video")).toHaveCount(1);
  });

  test("switches posts from a vertical gesture on the fullscreen video surface", async ({ page }) => {
    await installMediaElementMock(page);
    await mockFeedApis(page, [feedPost(), feedImagePost("after-video", "视频后的帖子")]);

    await page.goto("/feed");
    await page.locator('[data-feed-media="true"] video').click();
    const fullWebPlayer = page.locator("body > .art-video-player.art-fullscreen-web");
    await expect(fullWebPlayer.getByRole("button", { name: "下一条帖子（J）" })).toBeVisible();

    await fullWebPlayer.dispatchEvent("pointerdown", {
      pointerId: 12,
      pointerType: "touch",
      button: 0,
      clientX: 240,
      clientY: 620,
    });
    await fullWebPlayer.dispatchEvent("pointermove", {
      pointerId: 12,
      pointerType: "touch",
      button: 0,
      clientX: 240,
      clientY: 410,
    });
    await fullWebPlayer.dispatchEvent("pointerup", {
      pointerId: 12,
      pointerType: "touch",
      button: 0,
      clientX: 240,
      clientY: 410,
    });

    await expect(page.getByRole("dialog").getByText("视频后的帖子", { exact: true })).toBeVisible();
    await expect(page.locator("body > .art-video-player.art-fullscreen-web")).toHaveCount(0);
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
    let rememberedPreviewVideo: HTMLVideoElement | null = null;

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
      rememberPreviewVideo() {
        rememberedPreviewVideo = document.querySelector<HTMLVideoElement>(".art-video-player video");
      },
      previewVideoIsStable() {
        return rememberedPreviewVideo !== null && rememberedPreviewVideo === document.querySelector(".art-video-player video");
      },
    };
  });
}

async function mockFeedApis(
  page: Page,
  postsSource: Array<Record<string, unknown>> | (() => Array<Record<string, unknown>>) = [feedPost()],
  options: {
    pageSize?: number;
    totalCount?: () => number;
    waitForOffset?: (offset: number) => Promise<void>;
  } = {},
) {
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
      const posts = typeof postsSource === "function" ? postsSource() : postsSource;
      const offset = Number(url.searchParams.get("offset") ?? 0);
      await options.waitForOffset?.(offset);
      const pageSize = options.pageSize ?? 20;
      const rows = posts.slice(offset, offset + pageSize);
      return json(route, {
        rows,
        count: rows.length,
        total_count: options.totalCount?.() ?? posts.length,
        limit: pageSize,
        offset,
      });
    }
    if (path.startsWith("/api/v1/media-file/")) {
      return route.fulfill({ status: 204, body: "" });
    }

    return route.fulfill({ status: 404, json: { error: `Unhandled test route: ${path}` } });
  });
}

async function installRuntimeSocket(page: Page) {
  let runtimeSocket: WebSocketRoute | null = null;
  await page.routeWebSocket("**/api/v1/runtime/ws", (socket) => {
    runtimeSocket = socket;
    socket.send(JSON.stringify(runtimeEnvelope("runtime.snapshot", 10, 1, runtimeSnapshot())));
  });
  return {
    socket: () => expect.poll(() => runtimeSocket).not.toBeNull().then(() => runtimeSocket!),
  };
}

function runtimeEnvelope(type: string, sequence: number, connectionSequence: number, payload: Record<string, unknown>) {
  return {
    protocol: 1,
    type,
    epoch: "feed-preview-test",
    sequence,
    connection_sequence: connectionSequence,
    sent_at: "2026-08-30T00:00:00Z",
    payload,
  };
}

function runtimeSnapshot() {
  return {
    epoch: "feed-preview-test",
    sequence: 10,
    recent_window_seconds: 120,
    worker: { stop_requested: false, write_lock_held: false },
    queue: healthDetail().queue,
    sources: healthDetail().sources,
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

function feedImagePost(tweetId: string, text: string) {
  return {
    ...feedPost(),
    tweet_id: tweetId,
    tweet_url: `https://x.com/example/status/${tweetId}`,
    tweet_text: text,
    media: [
      {
        id: Number(tweetId.replace(/\D/g, "")) || text.charCodeAt(text.length - 1),
        tweet_id: tweetId,
        media_index: 0,
        media_type: "photo",
        media_status: "verified",
        source_engine: "fixture",
        local_path: `/archive/media/example/${tweetId}/0.jpg`,
        media_relative_path: `media/example/${tweetId}/0.jpg`,
        media_url: "data:image/gif;base64,R0lGODlhAQABAAAAACw=",
        preview_relative_path: `media/example/${tweetId}/0.jpg`,
        preview_url: "data:image/gif;base64,R0lGODlhAQABAAAAACw=",
        file_size: 64,
        width: 1,
        height: 1,
        duration_ms: null,
      },
    ],
  };
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
