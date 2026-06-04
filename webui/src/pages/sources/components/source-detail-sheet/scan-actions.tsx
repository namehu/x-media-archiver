import * as React from "react";
import type { ArchiveSourceDetail, SourceScanRun } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { scanModeLabel, getActiveScanMode } from "../../utils";
import { ActionBlock } from "./action-block";
import { ErrorLine } from "./error-line";
import type { NumberInputState } from "./use-number-input";

const MIN_SCAN_LIMIT = 5;

type ScanMode = "history" | "latest_refresh" | "from_start";

type DetailActions = {
  submitRecords: (input: { sourceId: number; records: Array<{ url: string }> }) => void;
  setStatus: (input: { sourceId: number; status: "active" | "paused" }) => void;
  startSession: (input: { sourceId: number; mode: ScanMode; limit: number; restart?: boolean }) => void;
  pauseSession: (sourceId: number) => void;
  resumeSession: (sourceId: number) => void;
  submitDiscovered: (input: { sourceId: number; limit?: number }) => void;
  stopHistory: (sourceId: number) => void;
  pending: {
    submit: boolean;
    status: boolean;
    submitDiscovered: boolean;
    history: boolean;
  };
  errors: {
    submit: unknown;
    status: unknown;
    submitDiscovered: unknown;
    history: unknown;
  };
};

export function ScanActions({
  source,
  actions,
  scanFeedback,
  scanLimit,
  onOpenLog,
}: {
  source: ArchiveSourceDetail;
  actions: DetailActions;
  scanFeedback: Record<string, unknown> | null;
  scanLimit: NumberInputState;
  onOpenLog: (run: SourceScanRun) => void;
}) {
  const activeRun = source.active_scan_run;
  const cursorState = source.cursor_state ?? {};
  const activeMode = getActiveScanMode(source);
  const automationEnabled = Boolean(cursorState.automation_enabled);
  const isStopped = cursorState.automation_state === "stopped";
  const isPaused = !isStopped && (source.status === "paused" || cursorState.automation_state === "paused");
  const isRunning =
    Boolean(activeRun) ||
    (automationEnabled && source.status === "active" && cursorState.automation_state !== "stopped");
  const hasDiscovered = Number(source.discovered_tweet_count || source.discovered_count || 0) > 0;
  const modeLabel = scanModeLabel(activeMode);
  const canStart = !actions.pending.history && !isRunning && !isPaused;
  const start = (mode: ScanMode, restart = false) =>
    actions.startSession({ sourceId: source.id, mode, limit: scanLimit.clamped(200), restart });

  return (
    <ActionBlock
      title="扫描来源"
      hint="扫描只发现并记录 Tweet 与媒体预估，不会自动提交下载；同一来源同一时间只运行一个扫描会话。"
    >
      <Input
        className="w-28"
        type="number"
        min={MIN_SCAN_LIMIT}
        max={200}
        value={scanLimit.value}
        onChange={scanLimit.onChange}
      />
      {isRunning ? (
        <>
          <Badge tone="secondary">正在{modeLabel}</Badge>
          <Button
            type="button"
            variant="secondary"
            disabled={actions.pending.history}
            onClick={() => actions.pauseSession(source.id)}
          >
            暂停
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={actions.pending.history}
            onClick={() => actions.stopHistory(source.id)}
          >
            停止
          </Button>
        </>
      ) : isPaused ? (
        <>
          <Badge tone="warning">已暂停：{modeLabel}</Badge>
          <Button type="button" disabled={actions.pending.history} onClick={() => actions.resumeSession(source.id)}>
            恢复{modeLabel}
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={actions.pending.history}
            onClick={() => actions.stopHistory(source.id)}
          >
            停止
          </Button>
        </>
      ) : (
        <ScanStartButtons
          source={source}
          activeMode={activeMode}
          hasDiscovered={hasDiscovered}
          canStart={canStart}
          onStart={start}
        />
      )}
      {activeRun ? (
        <button
          type="button"
          className="text-sm font-semibold text-brand hover:text-brand-hover"
          onClick={() => onOpenLog(activeRun)}
        >
          查看最新扫描日志
        </button>
      ) : null}
      {actions.errors.history || actions.errors.status ? (
        <ErrorLine error={actions.errors.history || actions.errors.status} />
      ) : null}
      {scanFeedback ? (
        <p className="basis-full rounded-lg bg-bg-muted p-3 text-sm text-fg-primary">
          本次扫描记录 {Number(scanFeedback.discovered_count || 0)} 条 Tweet，其中{" "}
          {Number(scanFeedback.new_discovered_count || 0)} 条为新发现、{Number(scanFeedback.duplicate_count || 0)}{" "}
          条已存在，尚未提交下载。{scanFeedback.completed ? "可能已到结尾" : ""}
        </p>
      ) : null}
    </ActionBlock>
  );
}

function ScanStartButtons({
  source,
  activeMode,
  hasDiscovered,
  canStart,
  onStart,
}: {
  source: ArchiveSourceDetail;
  activeMode: ScanMode;
  hasDiscovered: boolean;
  canStart: boolean;
  onStart: (mode: ScanMode, restart?: boolean) => void;
}) {
  const cursorState = source.cursor_state ?? {};
  const historySession = cursorState.scan_sessions?.history;
  const historyCompleted = source.status === "completed" || Boolean(historySession?.completed);
  const stopped = cursorState.automation_state === "stopped";
  const latestRefreshCompleted =
    activeMode === "latest_refresh" && cursorState.automation_state === "completed" && !cursorState.automation_enabled;

  if (!hasDiscovered && !stopped && !historyCompleted) {
    return (
      <Button type="button" disabled={!canStart} onClick={() => onStart("history")}>
        开始扫描
      </Button>
    );
  }

  if (historyCompleted) {
    return (
      <>
        <Button type="button" disabled={!canStart} onClick={() => onStart("latest_refresh", true)}>
          补充最新推文
        </Button>
        <Button type="button" variant="secondary" disabled={!canStart} onClick={() => onStart("from_start", true)}>
          从头扫描/补断层
        </Button>
      </>
    );
  }

  if (latestRefreshCompleted) {
    return (
      <Button type="button" disabled={!canStart} onClick={() => onStart("latest_refresh", true)}>
        再次补充最新推文
      </Button>
    );
  }

  return (
    <>
      {activeMode === "latest_refresh" ? (
        <Button type="button" disabled={!canStart} onClick={() => onStart("latest_refresh")}>
          继续补充最新推文
        </Button>
      ) : null}
      {activeMode === "from_start" ? (
        <Button type="button" disabled={!canStart} onClick={() => onStart("from_start")}>
          继续从头扫描/补断层
        </Button>
      ) : null}
      <Button type="button" disabled={!canStart} onClick={() => onStart("history")}>
        {activeMode === "history" ? "继续历史扫描" : "继续扫描历史"}
      </Button>
      <Button type="button" variant="secondary" disabled={!canStart} onClick={() => onStart("latest_refresh", true)}>
        补充最新推文
      </Button>
    </>
  );
}
