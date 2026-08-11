/**
 * 运行时状态 Provider（WebSocket 增量 + REST 快照回退）
 *
 * WebSocket 首帧快照后接收有序增量；连接不可用时定期拉取完整快照。
 * 任意时刻只允许其中一种 transport 写入 store，避免双通道竞态。
 */
import { useCallback, useEffect, useMemo, useRef, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { create } from "zustand";
import {
  apiGet,
  type RuntimeGlobal,
  type RuntimeItem,
  type RuntimeRun,
  type RuntimeSnapshot,
  type SourceScanRun,
} from "./api";
import {
  createEventInvalidationScheduler,
  invalidateRuntimePersistentQueries,
  type ServerEvent,
} from "./server-events";
import {
  RuntimeTransportController,
  type RuntimeTransportKind,
  type RuntimeWsEnvelope,
} from "./runtime-transport";

/**
 * 连接状态：
 * - connecting    建立 WebSocket 连接中
 * - connected     已连接且心跳正常
 * - reconnecting  WebSocket 断开，等待重连
 * - resyncing     正在拉取全量快照
 * - stale         超过阈值未收到事件，等待重新同步
 * - offline       WebSocket 与快照当前均不可用
 */
export type RuntimeConnectionStatus = "connecting" | "connected" | "reconnecting" | "resyncing" | "stale" | "offline";

/** 连接元信息：最近事件 / 最近快照时间戳，用于陈旧判定 */
type RuntimeConnection = {
  status: RuntimeConnectionStatus;
  transport: RuntimeTransportKind;
  lastEventAt?: number;
  lastSnapshotAt?: number;
};

export type RuntimeDiagnostics = {
  startedAt: number;
  transport: RuntimeTransportKind;
  messagesReceived: number;
  messageRatePerMinute: number;
  bytesReceived: number;
  stateCommits: number;
  reconnects: number;
  snapshots: number;
  drops: number;
  resyncs: number;
  lastCloseCode: number | null;
  lastMessageAt?: number;
};

/** Provider 对外暴露的运行时状态（WS 增量 + 快照全量合并后的最终形态） */
type RuntimeState = {
  /** 服务端 epoch：变化即视为连接重建，需重新快照 */
  epoch?: string;
  /** 已应用的最大事件序列号，用于去重与空洞检测 */
  sequence: number;
  /** 来源扫描的"最近窗口"秒数 */
  recentWindowSeconds: number;
  /** 连接状态与心跳信息 */
  connection: RuntimeConnection;
  /** worker 汇总信息 */
  worker?: RuntimeSnapshot["worker"];
  /** 队列信息 */
  queue?: RuntimeSnapshot["queue"];
  /** 来源列表 */
  sources?: RuntimeSnapshot["sources"];
  /** 全局汇总指标（活动 run/item 数、下载进度等） */
  global: RuntimeGlobal;
  /** run 索引 */
  runsById: Record<number, RuntimeRun>;
  /** item 索引 */
  itemsById: Record<number, RuntimeItem>;
  /** tweet_id -> 活动 item id 索引（同一 tweet 只保留最新一条活动条目） */
  activeItemIdByTweetId: Record<string, number>;
  /** 来源扫描 run 索引 */
  scansById: Record<number, SourceScanRun>;
  diagnostics: RuntimeDiagnostics;
};

/** useRuntimeSource 派生的单来源视图：按 tweet 去重的条目、活动条目与下载进度汇总 */
type RuntimeSourceState = {
  /** tweet_id -> 最新条目（同一 tweet 只保留 id 最大的一条） */
  itemsByTweetId: Map<string, RuntimeItem>;
  /** 进行中的条目列表 */
  activeItems: RuntimeItem[];
  /** 当前聚焦条目（优先当前 tweet，其次 processing，最后首条活动条目） */
  currentItem?: RuntimeItem;
  /** 当前活动 run id */
  activeRunId?: number | null;
  /** 当前活动 run / 条目状态 */
  activeRunStatus?: string | null;
  /** 当前条目 tweet id */
  currentTweetId?: string | null;
  /** 已下载字节合计 */
  downloadedBytes: number;
  /** 总字节合计（无值时 null） */
  totalBytes?: number | null;
  /** 下载速率合计 bps */
  speedBps?: number | null;
};

/** 进行中的条目状态：计入活动计数，参与下载进度统计 */
const ACTIVE_ITEM_STATUSES = new Set(["pending", "blocked", "processing", "failed_retryable"]);
/** 终态条目状态：一旦进入终态，后续事件不得再改写该条目状态 */
const TERMINAL_ITEM_STATUSES = new Set([
  "verified",
  "downloaded",
  "skipped_verified",
  "skipped_ignored",
  "linked_pending",
  "failed_permanent",
  "cancelled",
]);
/** 进行中的 run 状态：计入 active_run_count */
const ACTIVE_RUN_STATUSES = new Set(["queued", "running", "paused", "blocked"]);
const ACTIVE_SCAN_STATUSES = new Set(["running", "waiting_downloads"]);
/** 事件陈旧阈值：connected 状态下超过该时长无事件则触发重新快照 */
const STALE_THRESHOLD_MS = 45_000;
/** 快照最小间隔：对快照请求做节流，避免高频打爆后端 */
const SNAPSHOT_MIN_INTERVAL_MS = 2_000;
/** WS 不可用时的全量快照轮询间隔。 */
const SNAPSHOT_POLL_INTERVAL_MS = 5_000;
/** 持久事实查询的降级收敛上限，使用 trailing throttle 防止事件高峰制造请求风暴。 */
const PERSISTENT_QUERY_CONVERGENCE_INTERVAL_MS = 15_000;

/** 全局指标的空兜底值 */
const emptyGlobal: RuntimeGlobal = {
  active_run_count: 0,
  active_item_count: 0,
  active_scan_count: 0,
  downloaded_bytes: 0,
  total_bytes: null,
  speed_bps: null,
};

/** 初始运行时状态：connecting + 空数据 */
const initialRuntimeState: RuntimeState = {
  sequence: 0,
  recentWindowSeconds: 120,
  connection: { status: "connecting", transport: "websocket" },
  global: emptyGlobal,
  runsById: {},
  itemsById: {},
  activeItemIdByTweetId: {},
  scansById: {},
  diagnostics: {
    startedAt: Date.now(),
    transport: "websocket",
    messagesReceived: 0,
    messageRatePerMinute: 0,
    bytesReceived: 0,
    stateCommits: 0,
    reconnects: 0,
    snapshots: 0,
    drops: 0,
    resyncs: 0,
    lastCloseCode: null,
  },
};

const useRuntimeStore = create<RuntimeState>(() => initialRuntimeState);

export function RuntimeProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const snapshotInFlightRef = useRef(false);
  const snapshotTimerRef = useRef<number | null>(null);
  const lastSnapshotStartedAtRef = useRef(0);
  const persistentQueryTimerRef = useRef<number | null>(null);
  const lastPersistentQueryConvergenceAtRef = useRef(0);
  const transportRef = useRef<RuntimeTransportController | null>(null);
  const lastWsConnectionSequenceRef = useRef(0);
  const hasAppliedWebSocketSnapshotRef = useRef(false);
  const convergePersistentQueriesOnNextWebSocketSnapshotRef = useRef(false);
  const invalidationScheduler = useMemo(() => createEventInvalidationScheduler(queryClient), [queryClient]);

  const setConnection = useCallback((status: RuntimeConnectionStatus, transport?: RuntimeTransportKind, patch: Partial<RuntimeConnection> = {}) => {
    useRuntimeStore.setState((current) => ({
      ...current,
      connection: { ...current.connection, ...patch, status, transport: transport ?? current.connection.transport },
      diagnostics: {
        ...current.diagnostics,
        transport: transport ?? current.diagnostics.transport,
        stateCommits: current.diagnostics.stateCommits + 1,
      },
    }));
  }, []);

  const convergePersistentQueries = useCallback(() => {
    persistentQueryTimerRef.current = null;
    lastPersistentQueryConvergenceAtRef.current = Date.now();
    void invalidateRuntimePersistentQueries(queryClient);
  }, [queryClient]);

  const schedulePersistentQueryConvergence = useCallback(() => {
    if (persistentQueryTimerRef.current !== null) return;
    const waitMs = Math.max(
      0,
      PERSISTENT_QUERY_CONVERGENCE_INTERVAL_MS -
        (Date.now() - lastPersistentQueryConvergenceAtRef.current),
    );
    if (waitMs === 0) {
      convergePersistentQueries();
      return;
    }
    persistentQueryTimerRef.current = window.setTimeout(convergePersistentQueries, waitMs);
  }, [convergePersistentQueries]);

  const requestSnapshot = useCallback(
    (reason: "polling" | "manual", immediate = false) => {
      if (transportRef.current?.active === "websocket") return;
      if (snapshotInFlightRef.current) return;
      const now = Date.now();
      const waitMs = immediate ? 0 : Math.max(0, SNAPSHOT_MIN_INTERVAL_MS - (now - lastSnapshotStartedAtRef.current));
      if (waitMs > 0) {
        if (snapshotTimerRef.current !== null) return;
        snapshotTimerRef.current = window.setTimeout(() => {
          snapshotTimerRef.current = null;
          requestSnapshot(reason, true);
        }, waitMs);
        return;
      }

      snapshotInFlightRef.current = true;
      lastSnapshotStartedAtRef.current = now;
      const activeTransport = transportRef.current?.active ?? "polling";
      if (!useRuntimeStore.getState().connection.lastSnapshotAt) {
        setConnection("resyncing", activeTransport);
      }
      void apiGet<RuntimeSnapshot>("/api/v1/runtime/snapshot")
        .then((snapshot) => {
          const currentTransport = transportRef.current?.active ?? "polling";
          if (currentTransport === "websocket") return;
          const shouldConvergeQueries = snapshotRequiresPersistentQueryConvergence(
            useRuntimeStore.getState(),
            snapshot,
          );
          const syncedAt = Date.now();
          useRuntimeStore.setState((current) => {
            const next = replaceRuntimeWithSnapshot(current, snapshot);
            return {
              ...next,
              connection: {
                ...next.connection,
                status: "connected",
                transport: "polling",
                lastEventAt: syncedAt,
                lastSnapshotAt: syncedAt,
              },
              diagnostics: {
                ...next.diagnostics,
                transport: "polling",
                snapshots: next.diagnostics.snapshots + 1,
                stateCommits: next.diagnostics.stateCommits + 1,
              },
            };
          });
          if (shouldConvergeQueries) schedulePersistentQueryConvergence();
        })
        .catch(() => {
          if (transportRef.current?.active !== "websocket") {
            setConnection("offline", "polling");
          }
        })
        .finally(() => {
          snapshotInFlightRef.current = false;
        });
    },
    [schedulePersistentQueryConvergence, setConnection],
  );

  const handleWebSocketEnvelope = useCallback(
    (envelope: RuntimeWsEnvelope, byteLength: number) => {
      const now = Date.now();
      if (envelope.type === "runtime.snapshot") {
        lastWsConnectionSequenceRef.current = envelope.connection_sequence;
        const snapshot = envelope.payload as unknown as RuntimeSnapshot;
        if (!snapshot.epoch || !Array.isArray(snapshot.items) || !Array.isArray(snapshot.runs)) {
          transportRef.current?.reconnectNow();
          return;
        }
        const shouldConvergeQueries =
          !hasAppliedWebSocketSnapshotRef.current ||
          convergePersistentQueriesOnNextWebSocketSnapshotRef.current ||
          snapshotRequiresPersistentQueryConvergence(useRuntimeStore.getState(), snapshot);
        useRuntimeStore.setState((current) => {
          const next = replaceRuntimeWithSnapshot(current, snapshot);
          return {
            ...next,
            connection: { status: "connected", transport: "websocket", lastEventAt: now, lastSnapshotAt: now },
            diagnostics: {
              ...recordMessageDiagnostics(next.diagnostics, "websocket", byteLength),
              snapshots: next.diagnostics.snapshots + 1,
            },
          };
        });
        hasAppliedWebSocketSnapshotRef.current = true;
        convergePersistentQueriesOnNextWebSocketSnapshotRef.current = false;
        if (shouldConvergeQueries) schedulePersistentQueryConvergence();
        return;
      }

      const currentEpoch = useRuntimeStore.getState().epoch;
      if (currentEpoch && envelope.epoch && currentEpoch !== envelope.epoch) {
        transportRef.current?.reconnectNow();
        return;
      }
      const previousConnectionSequence = lastWsConnectionSequenceRef.current;
      if (previousConnectionSequence && envelope.connection_sequence !== previousConnectionSequence + 1) {
        useRuntimeStore.setState((current) => ({
          ...current,
          connection: { ...current.connection, status: "resyncing", transport: "websocket" },
          diagnostics: {
            ...current.diagnostics,
            drops: current.diagnostics.drops + 1,
            resyncs: current.diagnostics.resyncs + 1,
            stateCommits: current.diagnostics.stateCommits + 1,
          },
        }));
        transportRef.current?.reconnectNow();
        return;
      }
      lastWsConnectionSequenceRef.current = envelope.connection_sequence;

      if (envelope.type === "runtime.patch") {
        useRuntimeStore.setState((current) => {
          const next = applyRuntimePatch(current, envelope);
          return {
            ...next,
            connection: { ...next.connection, status: "connected", transport: "websocket", lastEventAt: now },
            diagnostics: recordMessageDiagnostics(next.diagnostics, "websocket", byteLength),
          };
        });
        return;
      }
      if (envelope.type === "runtime.invalidate") {
        const events = Array.isArray(envelope.payload.events) ? envelope.payload.events : [];
        for (const event of events) invalidationScheduler.schedule(event as ServerEvent);
      }
      const resyncRequired = envelope.type === "system.resync_required";
      const queueOverflow = resyncRequired && envelope.payload.reason === "outbound_queue_overflow";
      useRuntimeStore.setState((current) => ({
        ...current,
        sequence: Math.max(current.sequence, envelope.sequence || 0),
        connection: {
          ...current.connection,
          status: resyncRequired ? "resyncing" : "connected",
          transport: "websocket",
          lastEventAt: now,
        },
        diagnostics: {
          ...recordMessageDiagnostics(current.diagnostics, "websocket", byteLength),
          drops: current.diagnostics.drops + (queueOverflow ? 1 : 0),
          resyncs: current.diagnostics.resyncs + (resyncRequired ? 1 : 0),
        },
      }));
    },
    [invalidationScheduler, schedulePersistentQueryConvergence],
  );

  useEffect(() => {
    const controller = new RuntimeTransportController({
      onStatus: (status, transport) => {
        if (status === "reconnecting" && hasAppliedWebSocketSnapshotRef.current) {
          convergePersistentQueriesOnNextWebSocketSnapshotRef.current = true;
        }
        setConnection(status, transport);
        if (status === "offline" && transport === "polling") {
          schedulePersistentQueryConvergence();
          requestSnapshot("manual", true);
        }
      },
      onWebSocketEnvelope: handleWebSocketEnvelope,
      onReconnect: () => {
        if (hasAppliedWebSocketSnapshotRef.current) {
          convergePersistentQueriesOnNextWebSocketSnapshotRef.current = true;
        }
        useRuntimeStore.setState((current) => ({
          ...current,
          diagnostics: { ...current.diagnostics, reconnects: current.diagnostics.reconnects + 1 },
        }));
      },
      onClose: (code) => {
        useRuntimeStore.setState((current) => ({
          ...current,
          diagnostics: { ...current.diagnostics, lastCloseCode: code },
        }));
      },
    });
    transportRef.current = controller;
    controller.start();
    return () => {
      controller.stop();
      if (transportRef.current === controller) transportRef.current = null;
    };
  }, [handleWebSocketEnvelope, requestSnapshot, schedulePersistentQueryConvergence, setConnection]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (transportRef.current?.active === "polling") requestSnapshot("polling");
    }, SNAPSHOT_POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [requestSnapshot]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const current = useRuntimeStore.getState();
      if (current.connection.status !== "connected" || current.connection.transport !== "websocket") return;
      const lastEventAt = current.connection.lastEventAt;
      if (lastEventAt && Date.now() - lastEventAt > STALE_THRESHOLD_MS) {
        setConnection("stale", current.connection.transport);
        transportRef.current?.reconnectNow();
      }
    }, 5000);
    return () => window.clearInterval(timer);
  }, [setConnection]);

  useEffect(() => {
    const diagnosticsTimer = window.setInterval(persistRuntimeDiagnostics, 10_000);
    return () => {
      if (snapshotTimerRef.current !== null) window.clearTimeout(snapshotTimerRef.current);
      if (persistentQueryTimerRef.current !== null) window.clearTimeout(persistentQueryTimerRef.current);
      window.clearInterval(diagnosticsTimer);
      invalidationScheduler.dispose();
    };
  }, [invalidationScheduler]);

  return <>{children}</>;
}

/** 使用 selector 读取运行时状态，避免订阅整棵 runtime store */
export function useRuntime<T>(selector: (state: RuntimeState) => T): T {
  return useRuntimeStore(selector);
}

/** 只读取连接状态 */
export function useRuntimeConnection() {
  const status = useRuntimeStore((state) => state.connection.status);
  const transport = useRuntimeStore((state) => state.connection.transport);
  return useMemo(() => ({ status, transport }), [status, transport]);
}

/** 读取不含业务 payload 的有界运行时诊断计数。 */
export function useRuntimeDiagnostics() {
  return useRuntimeStore((state) => state.diagnostics);
}

/**
 * 派生单个来源的运行时视图：
 * - 按 tweet_id 保留最新条目做去重；
 * - 只保留进行中条目，并推断当前聚焦条目与活动 run；
 * - 汇总进行中条目的下载字节与速率。
 */
export function useRuntimeSource(sourceId: number | null): RuntimeSourceState {
  const itemsById = useRuntimeStore((state) => state.itemsById);
  const runsById = useRuntimeStore((state) => state.runsById);
  const global = useRuntimeStore((state) => state.global);
  return useMemo(() => {
    if (sourceId === null) return emptyRuntimeSourceState();
    const sourceItems = Object.values(itemsById).filter((item) => item.source_id === sourceId);
    const itemsByTweetId = new Map<string, RuntimeItem>();
    for (const item of sourceItems) {
      const current = itemsByTweetId.get(item.tweet_id);
      if (!current || item.id > current.id) itemsByTweetId.set(item.tweet_id, item);
    }
    const activeItems = sourceItems.filter((item) => ACTIVE_ITEM_STATUSES.has(item.status));
    const currentItem =
      activeItems.find((item) => item.tweet_id === global.current_tweet_id) ??
      activeItems.find((item) => item.status === "processing") ??
      activeItems[0];
    const activeRunId =
      currentItem?.archive_run_id ??
      (global.current_source_id === sourceId ? global.current_run_id : null);
    const activeRun = activeRunId ? runsById[activeRunId] : undefined;
    const speedBps = sumNumbers(activeItems.map((item) => item.speed_bps).filter((value) => value && value > 0));
    const downloadedBytes = sumNumbers(activeItems.map((item) => item.downloaded_bytes));
    const totalBytes = sumNumbers(activeItems.map((item) => item.total_bytes).filter((value) => value && value > 0));
    return {
      itemsByTweetId,
      activeItems,
      currentItem,
      activeRunId,
      activeRunStatus: activeRun?.status ?? currentItem?.archive_run_status ?? null,
      currentTweetId: currentItem?.tweet_id ?? null,
      downloadedBytes,
      totalBytes: totalBytes || null,
      speedBps: speedBps || null,
    };
  }, [global, itemsById, runsById, sourceId]);
}

/** sourceId 为 null（无来源上下文）时的空视图 */
function emptyRuntimeSourceState(): RuntimeSourceState {
  return {
    itemsByTweetId: new Map(),
    activeItems: [],
    downloadedBytes: 0,
    totalBytes: null,
    speedBps: null,
  };
}

/** 用快照整体重建状态：重建全部索引 map，保留已有连接信息 */
function replaceRuntimeWithSnapshot(current: RuntimeState, snapshot: RuntimeSnapshot): RuntimeState {
  const runsById: Record<number, RuntimeRun> = {};
  for (const run of snapshot.runs) runsById[run.id] = run;

  const itemsById: Record<number, RuntimeItem> = {};
  const activeItemIdByTweetId: Record<string, number> = {};
  for (const item of snapshot.items) {
    const normalized = normalizeRuntimeItem(item, snapshot.sequence);
    if (!normalized) continue;
    itemsById[normalized.id] = normalized;
    indexActiveItem(activeItemIdByTweetId, normalized);
  }

  const scansById: Record<number, SourceScanRun> = {};
  for (const scan of snapshot.scans) scansById[scan.id] = scan;

  return {
    ...current,
    epoch: snapshot.epoch,
    sequence: snapshot.sequence,
    recentWindowSeconds: snapshot.recent_window_seconds,
    worker: snapshot.worker,
    queue: snapshot.queue,
    sources: snapshot.sources,
    global: snapshot.global,
    runsById,
    itemsById,
    activeItemIdByTweetId,
    scansById,
  };
}

/** 按实体合并 runtime patch；未变化的索引保持引用不变。 */
function applyRuntimePatch(current: RuntimeState, envelope: RuntimeWsEnvelope): RuntimeState {
  const payload = envelope.payload || {};
  const sequence = envelope.sequence || 0;
  const runValues = Array.isArray(payload.runs) ? payload.runs : [];
  const itemValues = Array.isArray(payload.items) ? payload.items : [];
  const scanValues = Array.isArray(payload.scans) ? payload.scans : [];

  let runsById = current.runsById;
  let itemsById = current.itemsById;
  let activeItemIdByTweetId = current.activeItemIdByTweetId;
  let scansById = current.scansById;
  let runsChanged = false;
  let itemsChanged = false;
  let scansChanged = false;

  for (const value of runValues) {
    const run = normalizeRuntimeRun(value);
    if (!run) continue;
    if (!runsChanged) {
      runsById = { ...runsById };
      runsChanged = true;
    }
    runsById[run.id] = mergeDefined(runsById[run.id], run);
  }

  for (const value of itemValues) {
    const item = normalizeRuntimeItem(value, sequence);
    if (!item) continue;
    const existing = itemsById[item.id];
    if (existing?.lastSequence && sequence <= existing.lastSequence) continue;
    if (!itemsChanged) {
      itemsById = { ...itemsById };
      activeItemIdByTweetId = { ...activeItemIdByTweetId };
      itemsChanged = true;
    }
    if (existing && TERMINAL_ITEM_STATUSES.has(existing.status) && !TERMINAL_ITEM_STATUSES.has(item.status)) {
      itemsById[item.id] = { ...existing, lastSequence: sequence };
      continue;
    }
    itemsById[item.id] = mergeDefined(existing, item);
    indexActiveItem(activeItemIdByTweetId, itemsById[item.id]);
  }

  for (const value of scanValues) {
    const scan = normalizeRuntimeScan(value);
    if (!scan) continue;
    if (!scansChanged) {
      scansById = { ...scansById };
      scansChanged = true;
    }
    scansById[scan.id] = mergeDefined(scansById[scan.id], scan);
  }

  const worker = isRecord(payload.worker) ? { ...current.worker, ...payload.worker } as RuntimeState["worker"] : current.worker;
  const queue = isRecord(payload.queue) ? { ...current.queue, ...payload.queue } as RuntimeState["queue"] : current.queue;
  const suppliedGlobal = isRecord(payload.global)
    ? ({ ...current.global, ...payload.global } as RuntimeGlobal)
    : current.global;
  let next: RuntimeState = {
    ...current,
    epoch: envelope.epoch || current.epoch,
    sequence: Math.max(current.sequence, sequence),
    worker,
    queue,
    global: suppliedGlobal,
    runsById,
    itemsById,
    activeItemIdByTweetId,
    scansById,
  };
  if (runsChanged || itemsChanged || scansChanged) next = { ...next, global: recomputeGlobal(next) };
  return next;
}

function snapshotRequiresPersistentQueryConvergence(
  current: RuntimeState,
  snapshot: RuntimeSnapshot,
) {
  if (!current.epoch) return false;
  return current.epoch !== snapshot.epoch || snapshot.sequence > current.sequence;
}

/** 归一化 run 载荷；缺少合法 id 视为非法输入返回 null */
function normalizeRuntimeRun(value: unknown): RuntimeRun | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const id = numberValue(record.id);
  if (!id) return null;
  return record as RuntimeRun;
}

/** 归一化稀疏 scan patch；完整字段在 snapshot 中补齐。 */
function normalizeRuntimeScan(value: unknown): SourceScanRun | null {
  if (!isRecord(value)) return null;
  const id = numberValue(value.id ?? value.scan_run_id ?? value.source_scan_run_id);
  if (!id) return null;
  return { ...value, id } as SourceScanRun;
}

/** 归一化 item 载荷：补齐 id / archive_run_id / tweet_id / status / lastSequence；缺任一关键字段返回 null */
function normalizeRuntimeItem(value: unknown, sequence: number): RuntimeItem | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const id = numberValue(record.id ?? record.archive_run_item_id);
  const archiveRunId = numberValue(record.archive_run_id);
  const tweetId = typeof record.tweet_id === "string" ? record.tweet_id : "";
  const status = typeof record.status === "string" ? record.status : "";
  if (!id || !archiveRunId || !tweetId || !status) return null;
  return {
    ...(record as RuntimeItem),
    id,
    archive_run_item_id: id,
    archive_run_id: archiveRunId,
    tweet_id: tweetId,
    status,
    lastSequence: sequence,
  };
}

/** 维护 tweet_id -> 活动 item id 索引：仅保留 id 最大的一条；条目进入终态时清理自身索引 */
function indexActiveItem(activeItemIdByTweetId: Record<string, number>, item: RuntimeItem) {
  if (!ACTIVE_ITEM_STATUSES.has(item.status)) {
    if (activeItemIdByTweetId[item.tweet_id] === item.id) delete activeItemIdByTweetId[item.tweet_id];
    return;
  }
  const currentId = activeItemIdByTweetId[item.tweet_id];
  if (!currentId || item.id > currentId) activeItemIdByTweetId[item.tweet_id] = item.id;
}

/** 合并对象：仅覆盖显式赋值（值为 undefined 的键跳过），避免丢失现有字段 */
function mergeDefined<T extends object>(existing: T | undefined, next: T): T {
  const merged = { ...(existing || {}) } as Record<string, unknown>;
  for (const [key, value] of Object.entries(next)) {
    if (value !== undefined) {
      merged[key] = value;
    }
  }
  return merged as T;
}

/** 依据条目 / run 状态重算 global 汇总指标（计数、当前条目、下载字节与速率） */
function recomputeGlobal(runtime: RuntimeState): RuntimeGlobal {
  const items = Object.values(runtime.itemsById);
  const activeItems = items.filter((item) => ACTIVE_ITEM_STATUSES.has(item.status));
  const runs = Object.values(runtime.runsById);
  const activeRuns = runs.filter((run) => ACTIVE_RUN_STATUSES.has(run.status));
  const scans = Object.values(runtime.scansById);
  const activeScans = scans.filter((scan) => ACTIVE_SCAN_STATUSES.has(scan.status));
  const currentItem =
    activeItems.find((item) => item.tweet_id === runtime.global.current_tweet_id) ??
    activeItems.find((item) => item.status === "processing") ??
    activeItems[0];
  const currentRun = activeRuns.find((run) => run.id === currentItem?.archive_run_id) ?? activeRuns[0];
  const speedBps = sumNumbers(
    activeItems
      .filter((item) => item.status === "processing")
      .map((item) => item.speed_bps)
      .filter((value) => value && value > 0),
  );
  const downloadedBytes = sumNumbers(activeItems.map((item) => item.downloaded_bytes));
  const totalBytes = sumNumbers(activeItems.map((item) => item.total_bytes).filter((value) => value && value > 0));
  return {
    ...runtime.global,
    active_run_count: activeRuns.length,
    active_item_count: activeItems.length,
    active_scan_count: activeScans.length,
    current_run_id: currentItem?.archive_run_id ?? currentRun?.id ?? null,
    current_source_id: currentItem?.source_id ?? currentRun?.source_id ?? null,
    current_tweet_id: currentItem?.tweet_id ?? null,
    downloaded_bytes: downloadedBytes,
    total_bytes: totalBytes || null,
    speed_bps: speedBps || null,
  };
}

/** 安全的数字转换：有限数字或可解析的数字字符串返回 number，否则 null */
function numberValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function recordMessageDiagnostics(
  current: RuntimeDiagnostics,
  transport: RuntimeTransportKind,
  byteLength: number,
): RuntimeDiagnostics {
  const now = Date.now();
  recentMessageTimestamps.push(now);
  while (recentMessageTimestamps[0] < now - 60_000) recentMessageTimestamps.shift();
  if (recentMessageTimestamps.length > RECENT_MESSAGE_SAMPLE_LIMIT) {
    recentMessageTimestamps.splice(0, recentMessageTimestamps.length - RECENT_MESSAGE_SAMPLE_LIMIT);
  }
  return {
    ...current,
    transport,
    messagesReceived: current.messagesReceived + 1,
    messageRatePerMinute: recentMessageTimestamps.length,
    bytesReceived: current.bytesReceived + Math.max(0, byteLength),
    stateCommits: current.stateCommits + 1,
    lastMessageAt: now,
  };
}

const RUNTIME_DIAGNOSTICS_STORAGE_KEY = "xma.runtime-diagnostics.v1";
const RUNTIME_DIAGNOSTICS_SAMPLE_LIMIT = 60;
const RECENT_MESSAGE_SAMPLE_LIMIT = 6000;
const recentMessageTimestamps: number[] = [];

/** 最近十分钟仅保存固定数量的计数快照，不记录事件 payload。 */
function persistRuntimeDiagnostics() {
  try {
    const diagnostics = useRuntimeStore.getState().diagnostics;
    const stored = window.localStorage.getItem(RUNTIME_DIAGNOSTICS_STORAGE_KEY);
    const samples = stored ? JSON.parse(stored) as unknown : [];
    const bounded = Array.isArray(samples) ? samples.slice(-(RUNTIME_DIAGNOSTICS_SAMPLE_LIMIT - 1)) : [];
    bounded.push({ at: Date.now(), ...diagnostics });
    window.localStorage.setItem(RUNTIME_DIAGNOSTICS_STORAGE_KEY, JSON.stringify(bounded));
  } catch (_error) {
    // 隐私模式或存储配额不足时，诊断仍保留在当前内存状态。
  }
}

/** 求和：忽略 null / undefined / 非有限数字 */
function sumNumbers(values: Array<number | null | undefined>) {
  return values.reduce<number>(
    (sum, value) => sum + (typeof value === "number" && Number.isFinite(value) ? value : 0),
    0,
  );
}
