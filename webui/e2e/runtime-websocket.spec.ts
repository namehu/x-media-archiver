import { expect, test, type Page, type Route, type WebSocketRoute } from "@playwright/test";

test("applies WebSocket snapshot and patch, then falls back to REST snapshots", async ({ page }) => {
  let runtimeSocket: WebSocketRoute | null = null;
  let snapshotRequests = 0;
  let healthRequests = 0;
  await page.routeWebSocket("**/api/v1/runtime/ws", (socket) => {
    runtimeSocket = socket;
    socket.send(JSON.stringify(envelope("runtime.snapshot", 10, 1, runtimeSnapshot("ws-tweet-1", 1024))));
  });
  await mockApis(page, {
    onRuntimeSnapshot: () => {
      snapshotRequests += 1;
    },
    onHealthDetail: () => {
      healthRequests += 1;
    },
  });

  await page.goto("/operations?tab=system");
  await expect(page.getByText("当前 ws-tweet-1", { exact: true })).toBeVisible();
  await expect(page.getByText("下载 1.0 KB/s", { exact: true })).toBeVisible();
  await expect(page.getByText("WebSocket", { exact: true })).toBeVisible();

  expect(runtimeSocket).not.toBeNull();
  runtimeSocket!.send(
    JSON.stringify(
      envelope("runtime.patch", 11, 2, {
        global: { current_tweet_id: "ws-tweet-2", speed_bps: 2048 },
      }),
    ),
  );
  await expect(page.getByText("当前 ws-tweet-2", { exact: true })).toBeVisible();
  await expect(page.getByText("下载 2.0 KB/s", { exact: true })).toBeVisible();

  await runtimeSocket!.close({ code: 1013, reason: "test_fallback" });
  await expect(page.getByText("REST 轮询", { exact: true })).toBeVisible();
  await expect(page.getByText("当前 rest-tweet", { exact: true })).toBeVisible();
  await expect.poll(() => snapshotRequests).toBeGreaterThan(0);
  await expect.poll(() => healthRequests).toBeGreaterThan(1);
});

test("keeps runtime diagnostics readable on a narrow mobile viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.routeWebSocket("**/api/v1/runtime/ws", (socket) => {
    socket.send(JSON.stringify(envelope("runtime.snapshot", 10, 1, runtimeSnapshot("mobile-tweet", 1024))));
  });
  await mockApis(page);

  await page.goto("/operations?tab=system");
  await expect(page.getByText("Runtime 通道", { exact: true })).toBeVisible();
  await expect(page.getByText("客户端消息速率", { exact: true })).toBeVisible();
  await expect(page.getByText("服务端 WS", { exact: true })).toBeVisible();
  const hasHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(hasHorizontalOverflow).toBe(false);
});

test("refreshes active persistent queries when WebSocket falls back", async ({ page }) => {
  let runtimeSocket: WebSocketRoute | null = null;
  let summaryRequests = 0;
  await page.routeWebSocket("**/api/v1/runtime/ws", (socket) => {
    runtimeSocket = socket;
    socket.send(JSON.stringify(envelope("runtime.snapshot", 10, 1, runtimeSnapshot("dashboard-tweet", 0))));
  });
  await mockApis(page, {
    onSummary: () => {
      summaryRequests += 1;
    },
  });

  await page.goto("/");
  await expect(page.getByText("媒体文件", { exact: true })).toBeVisible();
  await expect.poll(() => summaryRequests).toBe(1);

  expect(runtimeSocket).not.toBeNull();
  await runtimeSocket!.close({ code: 1013, reason: "test_persistent_convergence" });
  await expect.poll(() => summaryRequests, { timeout: 20_000 }).toBeGreaterThan(1);
  await expect(page.getByText("REST 快照轮询", { exact: true })).toBeVisible();
});

test("converges persistent queries when the first WebSocket snapshot arrives after page data", async ({ page }) => {
  let runtimeSocket: WebSocketRoute | null = null;
  let summaryRequests = 0;
  await page.routeWebSocket("**/api/v1/runtime/ws", (socket) => {
    runtimeSocket = socket;
  });
  await mockApis(page, {
    onSummary: () => {
      summaryRequests += 1;
    },
  });

  await page.goto("/");
  await expect.poll(() => summaryRequests).toBe(1);
  await expect.poll(() => runtimeSocket).not.toBeNull();

  runtimeSocket!.send(
    JSON.stringify(envelope("runtime.snapshot", 10, 1, runtimeSnapshot("startup-race", 0, 10))),
  );

  await expect(page.getByText("当前 startup-race", { exact: true })).toBeVisible();
  await expect.poll(() => summaryRequests, { timeout: 20_000 }).toBeGreaterThan(1);
});

test("converges persistent queries after reconnecting at an already applied sequence", async ({ page }) => {
  let runtimeSocket: WebSocketRoute | null = null;
  let connectionCount = 0;
  let summaryRequests = 0;
  let reconnectSnapshot = false;
  await page.routeWebSocket("**/api/v1/runtime/ws", (socket) => {
    connectionCount += 1;
    runtimeSocket = socket;
    const sequence = reconnectSnapshot ? 11 : 10;
    const tweetId = reconnectSnapshot ? "after-reconnect" : "before-disconnect";
    socket.send(
      JSON.stringify(envelope("runtime.snapshot", sequence, 1, runtimeSnapshot(tweetId, 0, sequence))),
    );
  });
  await mockApis(page, {
    onSummary: () => {
      summaryRequests += 1;
    },
  });

  await page.goto("/");
  await expect.poll(() => summaryRequests).toBe(1);
  await expect(page.getByText("当前 before-disconnect", { exact: true })).toBeVisible();
  expect(runtimeSocket).not.toBeNull();

  runtimeSocket!.send(
    JSON.stringify(
      envelope("runtime.patch", 11, 2, {
        global: { current_tweet_id: "patch-before-disconnect" },
      }),
    ),
  );
  await expect(page.getByText("当前 patch-before-disconnect", { exact: true })).toBeVisible();
  const connectionsBeforeDisconnect = connectionCount;
  reconnectSnapshot = true;
  await runtimeSocket!.close({ code: 1012, reason: "invalidate_not_delivered" });

  await expect.poll(() => connectionCount).toBeGreaterThan(connectionsBeforeDisconnect);
  await expect.poll(() => summaryRequests, { timeout: 20_000 }).toBeGreaterThan(1);
});

test("ignores late message, close, and timeout callbacks from a replaced WebSocket", async ({ page }) => {
  await page.goto("/");

  const result = await page.evaluate(async () => {
    const OriginalWebSocket = window.WebSocket;
    const originalSetTimeout = window.setTimeout;
    const originalClearTimeout = window.clearTimeout;
    const instances: FakeWebSocket[] = [];
    const timerCallbacks = new Map<number, () => void>();
    let nextTimerId = 1;

    class FakeWebSocket {
      static readonly CONNECTING = 0;
      static readonly OPEN = 1;
      static readonly CLOSING = 2;
      static readonly CLOSED = 3;

      readyState = FakeWebSocket.CONNECTING;
      closeCalls = 0;
      onmessage: ((event: { data: string }) => void) | null = null;
      onclose: ((event: { code: number }) => void) | null = null;

      constructor(_url: string) {
        instances.push(this);
      }

      close() {
        this.closeCalls += 1;
        this.readyState = FakeWebSocket.CLOSING;
      }

      emit(value: Record<string, unknown>) {
        this.onmessage?.({ data: JSON.stringify(value) });
      }
    }

    Object.defineProperty(window, "WebSocket", { configurable: true, value: FakeWebSocket });
    Object.defineProperty(window, "setTimeout", {
      configurable: true,
      value: (handler: () => void) => {
        const timerId = nextTimerId;
        nextTimerId += 1;
        timerCallbacks.set(timerId, handler);
        return timerId;
      },
    });
    Object.defineProperty(window, "clearTimeout", {
      configurable: true,
      value: (_timerId: number) => undefined,
    });
    try {
      const moduleUrl = `${window.location.origin}/src/lib/runtime-transport.ts`;
      const { RuntimeTransportController } = await import(/* @vite-ignore */ moduleUrl);
      const received: string[] = [];
      const closeCodes: Array<number | null> = [];
      let reconnects = 0;
      const controller = new RuntimeTransportController({
        onStatus: () => undefined,
        onWebSocketEnvelope: (value: { payload: { marker?: string } }) => {
          received.push(value.payload.marker ?? "unknown");
        },
        onReconnect: () => {
          reconnects += 1;
        },
        onClose: (code: number | null) => {
          closeCodes.push(code);
        },
      });

      const snapshot = (marker: string, sequence: number) => ({
        protocol: 1,
        type: "runtime.snapshot",
        epoch: "epoch-transport-test",
        sequence,
        connection_sequence: 1,
        sent_at: "2026-08-09T12:00:00Z",
        payload: { marker },
      });

      controller.start();
      const first = instances[0];
      const firstConnectTimeout = timerCallbacks.get(1);
      first.readyState = FakeWebSocket.OPEN;
      first.emit(snapshot("first", 1));

      controller.reconnectNow();
      const second = instances[1];
      first.onclose?.({ code: 1012 });
      firstConnectTimeout?.();
      first.emit(snapshot("late-old-snapshot", 2));
      const activeAfterOldSnapshot = controller.active;
      const firstCloseCallsAfterLateTimeout = first.closeCalls;
      const secondCloseCallsAfterLateTimeout = second.closeCalls;

      second.readyState = FakeWebSocket.OPEN;
      second.emit(snapshot("second", 2));
      first.emit({
        ...snapshot("late-old-patch", 3),
        type: "runtime.patch",
        connection_sequence: 2,
      });
      const callbacksBeforeStop = { reconnects, closeCodes: [...closeCodes] };
      controller.stop();

      return {
        received,
        activeAfterOldSnapshot,
        firstCloseCallsAfterLateTimeout,
        secondCloseCallsAfterLateTimeout,
        callbacksBeforeStop,
      };
    } finally {
      Object.defineProperty(window, "WebSocket", { configurable: true, value: OriginalWebSocket });
      Object.defineProperty(window, "setTimeout", { configurable: true, value: originalSetTimeout });
      Object.defineProperty(window, "clearTimeout", { configurable: true, value: originalClearTimeout });
    }
  });

  expect(result.received).toEqual(["first", "second"]);
  expect(result.activeAfterOldSnapshot).toBeNull();
  expect(result.firstCloseCallsAfterLateTimeout).toBe(1);
  expect(result.secondCloseCallsAfterLateTimeout).toBe(0);
  expect(result.callbacksBeforeStop).toEqual({ reconnects: 0, closeCodes: [] });
});

test("defers closing a connecting WebSocket until its handshake completes", async ({ page }) => {
  await page.goto("/");

  const result = await page.evaluate(async () => {
    const OriginalWebSocket = window.WebSocket;
    const instances: FakeWebSocket[] = [];

    class FakeWebSocket {
      static readonly CONNECTING = 0;
      static readonly OPEN = 1;
      static readonly CLOSING = 2;
      static readonly CLOSED = 3;

      readyState = FakeWebSocket.CONNECTING;
      closeCalls: Array<{ code?: number; reason?: string }> = [];
      openListeners: Array<() => void> = [];
      onmessage: ((event: { data: string }) => void) | null = null;
      onclose: ((event: { code: number }) => void) | null = null;

      constructor(_url: string) {
        instances.push(this);
      }

      addEventListener(type: string, listener: () => void) {
        if (type === "open") this.openListeners.push(listener);
      }

      close(code?: number, reason?: string) {
        this.closeCalls.push({ code, reason });
        this.readyState = FakeWebSocket.CLOSING;
      }

      emitOpen() {
        this.readyState = FakeWebSocket.OPEN;
        for (const listener of this.openListeners.splice(0)) listener();
      }

      emit(value: Record<string, unknown>) {
        this.onmessage?.({ data: JSON.stringify(value) });
      }
    }

    Object.defineProperty(window, "WebSocket", { configurable: true, value: FakeWebSocket });
    try {
      const moduleUrl = `${window.location.origin}/src/lib/runtime-transport.ts`;
      const { RuntimeTransportController } = await import(/* @vite-ignore */ moduleUrl);
      const controller = new RuntimeTransportController({
        onStatus: () => undefined,
        onWebSocketEnvelope: () => undefined,
        onReconnect: () => undefined,
        onClose: () => undefined,
      });

      controller.start();
      const websocket = instances[0];
      controller.stop();
      const closeCallsBeforeOpen = [...websocket.closeCalls];
      websocket.emitOpen();

      const resumedController = new RuntimeTransportController({
        onStatus: () => undefined,
        onWebSocketEnvelope: () => undefined,
        onReconnect: () => undefined,
        onClose: () => undefined,
      });
      resumedController.start();
      const healthyWebsocket = instances[1];
      healthyWebsocket.emitOpen();
      healthyWebsocket.emit({
        protocol: 1,
        type: "runtime.snapshot",
        epoch: "epoch-resume-test",
        sequence: 1,
        connection_sequence: 1,
        sent_at: "2026-08-10T00:00:00Z",
        payload: {},
      });
      const resume = () =>
        (resumedController as unknown as { handleResume: () => void }).handleResume();
      const instancesBeforeHealthyResume = instances.length;
      resume();
      const instancesAfterHealthyResume = instances.length;
      healthyWebsocket.readyState = FakeWebSocket.CLOSED;
      resume();
      const instancesAfterClosedResume = instances.length;
      resumedController.stop();

      return {
        closeCallsBeforeOpen,
        closeCallsAfterOpen: websocket.closeCalls,
        instancesBeforeHealthyResume,
        instancesAfterHealthyResume,
        instancesAfterClosedResume,
      };
    } finally {
      Object.defineProperty(window, "WebSocket", { configurable: true, value: OriginalWebSocket });
    }
  });

  expect(result.closeCallsBeforeOpen).toEqual([]);
  expect(result.closeCallsAfterOpen).toEqual([
    { code: 1000, reason: "runtime_provider_unmounted" },
  ]);
  expect(result.instancesAfterHealthyResume).toBe(result.instancesBeforeHealthyResume);
  expect(result.instancesAfterClosedResume).toBe(result.instancesBeforeHealthyResume + 1);
});

async function mockApis(
  page: Page,
  hooks: {
    onRuntimeSnapshot?: () => void;
    onHealthDetail?: () => void;
    onSummary?: () => void;
  } = {},
) {
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/v1/auth/session") {
      return json(route, {
        status: "authenticated",
        auth_mode: "password",
        user: { username: "runtime-test" },
      });
    }
    if (path === "/api/v1/runtime/snapshot") {
      hooks.onRuntimeSnapshot?.();
      return json(route, runtimeSnapshot("rest-tweet", 2048));
    }
    if (path === "/api/v1/runtime/diagnostics") {
      return json(route, {
        broker: {
          epoch: "epoch-1",
          sequence: 11,
          published_events: 11,
          published_by_type: {},
          sse_connections: 0,
          ws_connections: 1,
          queue_high_water: 2,
          dropped_events: 0,
          subscriptions: [],
        },
        websocket: {
          active_connections: 1,
          accepted_connections: 1,
          messages_sent: 2,
          bytes_sent: 1024,
          snapshots_sent: 1,
          patches_sent: 1,
          invalidations_sent: 0,
          heartbeats_sent: 0,
          resyncs_sent: 0,
          queue_overflows: 0,
          dropped_events: 0,
          auth_rejections: 0,
          origin_rejections: 0,
          send_errors: 0,
        },
      });
    }
    if (path === "/api/v1/library/summary") {
      hooks.onSummary?.();
      return json(route, {
        tweet_status_counts: { downloaded: 1 },
        media_count: 1,
        failure_count: 0,
        archive_dir: "/app/archive",
        exports: [],
      });
    }
    if (path === "/api/v1/health/detail") {
      hooks.onHealthDetail?.();
      return json(route, healthDetail());
    }
    return json(route, {}, 404);
  });
}

function envelope(type: string, sequence: number, connectionSequence: number, payload: Record<string, unknown>) {
  return {
    protocol: 1,
    type,
    epoch: "epoch-1",
    sequence,
    connection_sequence: connectionSequence,
    sent_at: "2026-08-09T12:00:00Z",
    payload,
  };
}

function runtimeSnapshot(tweetId: string, speedBps: number, sequence = 10) {
  return {
    epoch: "epoch-1",
    sequence,
    recent_window_seconds: 120,
    worker: { stop_requested: false, write_lock_held: false },
    queue: healthDetail().queue,
    sources: healthDetail().sources,
    global: {
      active_run_count: 1,
      active_item_count: 1,
      active_scan_count: 0,
      current_run_id: 71,
      current_source_id: 9,
      current_tweet_id: tweetId,
      downloaded_bytes: 1024,
      total_bytes: 4096,
      speed_bps: speedBps,
    },
    runs: [{ id: 71, trigger_type: "source_download", source_id: 9, status: "running" }],
    items: [runtimeItem(tweetId, speedBps)],
    scans: [],
    recent_activity: [],
  };
}

function runtimeItem(tweetId: string, speedBps: number) {
  return {
    id: 81,
    archive_run_item_id: 81,
    archive_run_id: 71,
    source_id: 9,
    tweet_id: tweetId,
    status: "processing",
    retry_count: 0,
    cancel_requested: false,
    downloaded_bytes: 1024,
    total_bytes: 4096,
    speed_bps: speedBps,
  };
}

function healthDetail() {
  return {
    status: "ok",
    worker: { stop_requested: false, write_lock_held: false },
    db_pool: { active: 0, idle: 1, waiting: 0, min_size: 1, max_size: 5 },
    queue: {
      pending_items: 0,
      processing_items: 1,
      retryable_failed_items: 0,
      permanent_failed_items: 0,
      queued_runs: 0,
      running_runs: 1,
    },
    sources: {
      active_sources: 1,
      paused_sources: 0,
      failed_sources: 0,
      history_enabled_sources: 0,
      active_scan_runs: 0,
    },
    recent_errors: [],
  };
}

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}
