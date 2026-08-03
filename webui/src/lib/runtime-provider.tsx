/**
 * 运行时状态 Provider（SSE 事件流 + 快照回退）
 *
 * 通过 EventSource 订阅后端事件流，维护归档运行时的全量状态
 * （worker / queue / sources / runs / items / scans / global 汇总指标）。
 *
 * 核心机制：
 * - 事件按 epoch + sequence 单调递增，用于检测连接切换、序列空洞与丢事件；
 * - 检测到空洞 / epoch 变化 / 长时间无事件时，回退拉取全量快照；
 * - 快照在途期间到达的事件先进入缓冲队列，快照返回后按序列重放，避免丢失；
 * - 每条 item 记录 lastSequence，用于去重并防止旧事件覆盖新状态。
 */
import { useCallback, useEffect, useMemo, useRef, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { create } from "zustand";
import {
  apiGet,
  apiUrl,
  type RuntimeGlobal,
  type RuntimeItem,
  type RuntimeRun,
  type RuntimeSnapshot,
  type SourceScanRun,
} from "./api";
import { invalidateForEvent, parseServerEvent, SERVER_EVENT_TYPES, type ServerEvent } from "./server-events";

/**
 * 连接状态：
 * - connecting    建立 SSE 连接中
 * - connected     已连接且心跳正常
 * - reconnecting  SSE 断开，浏览器自动重连中
 * - resyncing     正在拉取全量快照
 * - stale         超过阈值未收到事件，等待重新同步
 * - offline       快照拉取失败 / 环境不支持 EventSource
 */
export type RuntimeConnectionStatus = "connecting" | "connected" | "reconnecting" | "resyncing" | "stale" | "offline";

/** 连接元信息：最近事件 / 最近快照时间戳，用于陈旧判定 */
type RuntimeConnection = {
  status: RuntimeConnectionStatus;
  lastEventAt?: number;
  lastSnapshotAt?: number;
};

/** Provider 对外暴露的运行时状态（事件流增量 + 快照全量合并后的最终形态） */
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
  "linked_pending",
  "failed_permanent",
  "cancelled",
]);
/** 进行中的 run 状态：计入 active_run_count */
const ACTIVE_RUN_STATUSES = new Set(["queued", "running", "paused", "blocked"]);
/** 事件陈旧阈值：connected 状态下超过该时长无事件则触发重新快照 */
const STALE_THRESHOLD_MS = 30_000;
/** 快照最小间隔：对快照请求做节流，避免高频打爆后端 */
const SNAPSHOT_MIN_INTERVAL_MS = 2_000;
/** 快照在途期间事件缓冲上限：超过则标记溢出，快照后再次拉取补全 */
const SNAPSHOT_BUFFER_LIMIT = 500;

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
  connection: { status: "connecting" },
  global: emptyGlobal,
  runsById: {},
  itemsById: {},
  activeItemIdByTweetId: {},
  scansById: {},
};

const useRuntimeStore = create<RuntimeState>(() => initialRuntimeState);

export function RuntimeProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  // snapshotInFlightRef：标记快照是否在途，在途期间事件一律进缓冲
  const snapshotInFlightRef = useRef(false);
  // snapshotTimerRef / lastSnapshotStartedAtRef：快照节流定时器与上次发起时间
  const snapshotTimerRef = useRef<number | null>(null);
  const lastSnapshotStartedAtRef = useRef(0);
  // bufferedEventsRef / bufferOverflowRef：快照在途期间的事件缓冲与溢出标记
  const bufferedEventsRef = useRef<ServerEvent[]>([]);
  const bufferOverflowRef = useRef(false);

  /** 更新连接状态（保留其他字段，patch 做部分覆盖） */
  const setConnection = useCallback((status: RuntimeConnectionStatus, patch: Partial<RuntimeConnection> = {}) => {
    useRuntimeStore.setState((current) => ({
      ...current,
      connection: { ...current.connection, ...patch, status },
    }));
  }, []);

  /** 缓冲快照在途期间到达的事件；超过上限只标记溢出，不再追加 */
  const bufferEvent = useCallback((event: ServerEvent) => {
    if (bufferedEventsRef.current.length >= SNAPSHOT_BUFFER_LIMIT) {
      bufferOverflowRef.current = true;
      return;
    }
    bufferedEventsRef.current.push(event);
  }, []);

  /**
   * 请求全量快照（带最小间隔节流，避免并发与高频请求）。
   * reason：触发原因；immediate：跳过节流立即执行。
   * 成功后将缓冲事件按序列重放；失败则置为 offline。
   */
  const requestSnapshot = useCallback(
    (reason: "connect" | "gap" | "epoch" | "stale" | "manual" | "buffer-overflow", immediate = false) => {
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
      setConnection("resyncing");
      void apiGet<RuntimeSnapshot>("/api/v1/runtime/snapshot")
        .then((snapshot) => {
          // 取出快照在途期间缓冲的事件：仅保留同 epoch 且序列号晚于快照的，按序列升序重放
          const buffered = bufferedEventsRef.current
            .filter((event) => event.epoch === snapshot.epoch && eventSequence(event) > snapshot.sequence)
            .sort((a, b) => eventSequence(a) - eventSequence(b));
          bufferedEventsRef.current = [];
          const hadOverflow = bufferOverflowRef.current;
          bufferOverflowRef.current = false;
          const syncedAt = Date.now();
          useRuntimeStore.setState((current) => {
            let next = replaceRuntimeWithSnapshot(current, snapshot);
            for (const event of buffered) {
              next = applyRuntimeEvent(next, event);
            }
            return {
              ...next,
              connection: {
                ...next.connection,
                status: "connected",
                lastEventAt: syncedAt,
                lastSnapshotAt: syncedAt,
              },
            };
          });
          if (hadOverflow) {
            window.setTimeout(() => requestSnapshot("buffer-overflow"), SNAPSHOT_MIN_INTERVAL_MS);
          }
        })
        .catch(() => {
          setConnection("offline");
        })
        .finally(() => {
          snapshotInFlightRef.current = false;
        });
    },
    [setConnection],
  );

  /**
   * SSE 消息入口：先更新连接心跳并失效相关 React Query 缓存，
   * 再按 epoch / sequence 规则决定「直接应用、缓冲待快照回退」还是「丢弃重复事件」。
   */
  const handleMessage = useCallback(
    (message: MessageEvent) => {
      const event = parseServerEvent(message);
      const sequence = eventSequence(event);
      const epoch = event.epoch;
      const now = Date.now();
      useRuntimeStore.setState((current) => ({
        ...current,
        connection: { ...current.connection, status: "connected", lastEventAt: now },
      }));
      invalidateForEvent(queryClient, event);

      if (!epoch || !sequence) return;
      const current = useRuntimeStore.getState();
      if (snapshotInFlightRef.current) {
        bufferEvent(event);
        return;
      }
      if (!current.epoch || epoch !== current.epoch) {
        bufferEvent(event);
        requestSnapshot("epoch", true);
        return;
      }
      if (sequence > current.sequence + 1) {
        bufferEvent(event);
        requestSnapshot("gap");
        return;
      }
      if (sequence <= current.sequence) return;
      useRuntimeStore.setState((value) => applyRuntimeEvent(value, event));
    },
    [bufferEvent, queryClient, requestSnapshot],
  );

  useEffect(() => {
    if (typeof EventSource === "undefined") {
      setConnection("offline");
      requestSnapshot("manual", true);
      return undefined;
    }

    let closed = false;
    setConnection("connecting");
    // 建立 SSE 事件流；onopen 即发起首次全量快照，onerror 标记重连中
    const eventSource = new EventSource(apiUrl("/api/v1/events"), { withCredentials: true });
    eventSource.onopen = () => {
      if (closed) return;
      setConnection("connected", { lastEventAt: Date.now() });
      requestSnapshot("connect", true);
    };
    eventSource.onerror = () => {
      if (!closed) setConnection("reconnecting");
    };
    eventSource.onmessage = handleMessage;
    for (const eventType of SERVER_EVENT_TYPES) {
      eventSource.addEventListener(eventType, handleMessage);
    }

    return () => {
      closed = true;
      eventSource.close();
    };
  }, [handleMessage, requestSnapshot, setConnection]);

  // 心跳检查：connected 状态下超过 STALE_THRESHOLD_MS 无事件则标记 stale 并触发重新快照
  useEffect(() => {
    const timer = window.setInterval(() => {
      const current = useRuntimeStore.getState();
      if (current.connection.status !== "connected") return;
      const lastEventAt = current.connection.lastEventAt;
      if (lastEventAt && Date.now() - lastEventAt > STALE_THRESHOLD_MS) {
        setConnection("stale");
        requestSnapshot("stale");
      }
    }, 5000);
    return () => window.clearInterval(timer);
  }, [requestSnapshot, setConnection]);

  // 卸载时清理快照节流定时器
  useEffect(
    () => () => {
      if (snapshotTimerRef.current !== null) window.clearTimeout(snapshotTimerRef.current);
    },
    [],
  );

  return <>{children}</>;
}

/** 使用 selector 读取运行时状态，避免订阅整棵 runtime store */
export function useRuntime<T>(selector: (state: RuntimeState) => T): T {
  return useRuntimeStore(selector);
}

/** 只读取连接状态 */
export function useRuntimeConnection() {
  const status = useRuntimeStore((state) => state.connection.status);
  return useMemo(() => ({ status }), [status]);
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

/** 取事件序列号：优先 sequence，其次 id；非法值兜底为 0 */
function eventSequence(event: ServerEvent) {
  const sequence = event.sequence ?? event.id ?? 0;
  return typeof sequence === "number" && Number.isFinite(sequence) ? sequence : 0;
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

/** 增量应用单个事件：浅拷贝并合并 run / item，做序列去重与终态保护，最后重算 global */
function applyRuntimeEvent(current: RuntimeState, event: ServerEvent): RuntimeState {
  const sequence = eventSequence(event);
  const payload = event.payload || {};
  const runsById = { ...current.runsById };
  const itemsById = { ...current.itemsById };
  const activeItemIdByTweetId = { ...current.activeItemIdByTweetId };

  const run = normalizeRuntimeRun(payload.run);
  if (run) runsById[run.id] = { ...runsById[run.id], ...run };

  const items = Array.isArray(payload.items) ? payload.items : [];
  for (const value of items) {
    const item = normalizeRuntimeItem(value, sequence);
    if (!item) continue;
    const existing = itemsById[item.id];
    if (existing?.lastSequence && sequence <= existing.lastSequence) continue;
    if (existing && TERMINAL_ITEM_STATUSES.has(existing.status) && !TERMINAL_ITEM_STATUSES.has(item.status)) {
      itemsById[item.id] = { ...existing, lastSequence: sequence };
      continue;
    }
    itemsById[item.id] = mergeDefined(existing, item);
    indexActiveItem(activeItemIdByTweetId, itemsById[item.id]);
  }

  const next = {
    ...current,
    sequence: Math.max(current.sequence, sequence),
    runsById,
    itemsById,
    activeItemIdByTweetId,
  };
  return { ...next, global: recomputeGlobal(next) };
}

/** 归一化 run 载荷；缺少合法 id 视为非法输入返回 null */
function normalizeRuntimeRun(value: unknown): RuntimeRun | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const id = numberValue(record.id);
  if (!id) return null;
  return record as RuntimeRun;
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
  const currentItem =
    activeItems.find((item) => item.status === "processing") ??
    activeItems.find((item) => item.tweet_id === runtime.global.current_tweet_id) ??
    activeItems[0];
  const speedBps = sumNumbers(activeItems.map((item) => item.speed_bps).filter((value) => value && value > 0));
  const downloadedBytes = sumNumbers(activeItems.map((item) => item.downloaded_bytes));
  const totalBytes = sumNumbers(activeItems.map((item) => item.total_bytes).filter((value) => value && value > 0));
  return {
    ...runtime.global,
    active_run_count: activeRuns.length,
    active_item_count: activeItems.length,
    current_run_id: currentItem?.archive_run_id ?? runtime.global.current_run_id ?? null,
    current_source_id: currentItem?.source_id ?? runtime.global.current_source_id ?? null,
    current_tweet_id: currentItem?.tweet_id ?? runtime.global.current_tweet_id ?? null,
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

/** 求和：忽略 null / undefined / 非有限数字 */
function sumNumbers(values: Array<number | null | undefined>) {
  return values.reduce<number>(
    (sum, value) => sum + (typeof value === "number" && Number.isFinite(value) ? value : 0),
    0,
  );
}
