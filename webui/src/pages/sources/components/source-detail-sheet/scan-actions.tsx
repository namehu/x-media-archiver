import * as React from "react";
import type { ArchiveSourceDetail, SourceScanRun } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { scanModeLabel, getActiveScanMode } from "../../utils";
import { ActionBlock } from "./action-block";
import { ErrorLine } from "./error-line";

type ScanMode = "history" | "latest_refresh" | "from_start";
type PendingConfirmation = { action: "start"; mode: ScanMode; restart: boolean; limit: number } | { action: "stop" };

export type DetailActions = {
  submitRecords: (input: { sourceId: number; records: Array<{ url: string }> }) => void;
  setStatus: (input: { sourceId: number; status: "active" | "paused" }) => void;
  startSession: (input: { sourceId: number; mode: ScanMode; limit: number; restart?: boolean }) => void;
  pauseSession: (sourceId: number) => void;
  resumeSession: (sourceId: number) => void;
  submitDiscovered: (input: { sourceId: number; limit?: number }) => void;
  submitDownload: (input: {
    sourceId: number;
    scope: "selected" | "all_unsubmitted" | "failed";
    tweetIds?: string[];
    limit?: number;
  }) => void;
  pauseDownload: (runId: number) => void;
  resumeDownload: (runId: number) => void;
  stopDownload: (runId: number) => void;
  cancelDownloadItems: (input: { runId: number; tweetIds: string[] }) => void;
  stopHistory: (sourceId: number) => void;
  pending: {
    submit: boolean;
    status: boolean;
    submitDiscovered: boolean;
    download: boolean;
    history: boolean;
  };
  errors: {
    submit: unknown;
    status: unknown;
    submitDiscovered: unknown;
    download: unknown;
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
  scanLimit: number;
  onOpenLog: (run: SourceScanRun) => void;
}) {
  const [confirmation, setConfirmation] = React.useState<PendingConfirmation | null>(null);
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
  const start = (mode: ScanMode, limit: number, restart = false) =>
    actions.startSession({ sourceId: source.id, mode, limit, restart });
  const confirm = () => {
    if (!confirmation) return;
    if (confirmation.action === "stop") {
      actions.stopHistory(source.id);
    } else {
      start(confirmation.mode, confirmation.limit, confirmation.restart);
    }
    setConfirmation(null);
  };

  return (
    <ActionBlock
      title="扫描来源"
      hint="扫描只发现并记录 Tweet 与媒体预估，不会自动提交下载；同一来源同一时间只运行一个扫描会话。每批先读取来源 cursor 与下一批范围；下载队列忙时只记录等待，空闲时才调用 gallery-dl 枚举。子进程完整返回后才会解析、去重并落库，再按延迟时间调度下一批。暂停只阻止后续调度，不会终止已启动的 gallery-dl 子进程；该批结束后会保留 cursor 与发现记录。"
    >
      <span className="text-sm text-fg-secondary">每批 <span className="font-semibold text-fg-primary">{scanLimit}</span> 条</span>
      {isRunning ? (
        <>
          <Badge tone="secondary">正在{modeLabel}</Badge>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={actions.pending.history}
            onClick={() => actions.pauseSession(source.id)}
          >
            暂停
          </Button>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={actions.pending.history}
            onClick={() => setConfirmation({ action: "stop" })}
          >
            停止
          </Button>
        </>
      ) : isPaused ? (
        <>
          <Badge tone="warning">已暂停：{modeLabel}</Badge>
          <Button
            type="button"
            size="sm"
            disabled={actions.pending.history}
            onClick={() => actions.resumeSession(source.id)}
          >
            恢复{modeLabel}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={actions.pending.history}
            onClick={() => setConfirmation({ action: "stop" })}
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
          onStart={(mode, restart) =>
            setConfirmation({ action: "start", mode, restart: Boolean(restart), limit: scanLimit })
          }
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
      <ScanConfirmationDialog
        confirmation={confirmation}
        pending={actions.pending.history}
        onConfirm={confirm}
        onLimitChange={(limit) =>
          setConfirmation((current) => (current?.action === "start" ? { ...current, limit } : current))
        }
        onOpenChange={(open) => !open && setConfirmation(null)}
      />
    </ActionBlock>
  );
}

function ScanConfirmationDialog({
  confirmation,
  pending,
  onConfirm,
  onLimitChange,
  onOpenChange,
}: {
  confirmation: PendingConfirmation | null;
  pending: boolean;
  onConfirm: () => void;
  onLimitChange: (limit: number) => void;
  onOpenChange: (open: boolean) => void;
}) {
  const isStop = confirmation?.action === "stop";
  const mode = confirmation?.action === "start" ? confirmation.mode : null;
  const limit = confirmation?.action === "start" ? confirmation.limit : 20;
  const modeLabel = mode ? scanModeLabel(mode) : "扫描";
  const title = isStop ? "停止扫描来源？" : `确认${modeLabel}？`;
  const description = isStop
    ? "将不再调度后续扫描批次。已经启动的 gallery-dl 批次会自然结束，已保存的 cursor 和发现记录不会丢失。"
    : mode === "from_start"
      ? `将从来源开头重新枚举，每批 ${limit} 条。此操作可能产生大量重复检查和新的扫描记录，但不会自动提交下载。`
      : `将按当前 cursor 执行${modeLabel}，每批 ${limit} 条。扫描只发现并记录 Tweet，不会自动提交下载。`;

  return (
    <AlertDialog open={Boolean(confirmation)} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        {!isStop ? (
          <label className="grid gap-2 text-sm font-medium text-fg-primary">
            本次每批扫描数量
            <Input
              className="w-28"
              type="number"
              min={5}
              max={200}
              value={limit}
              onChange={(event) => {
                const value = Number(event.target.value);
                if (Number.isFinite(value)) onLimitChange(Math.max(5, Math.min(200, Math.floor(value))));
              }}
            />
            <span className="text-xs font-normal text-fg-secondary">范围 5–200 条；确认后会作为该扫描会话的批次大小。</span>
          </label>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>取消</AlertDialogCancel>
          <AlertDialogAction disabled={pending} onClick={onConfirm}>
            {isStop ? "确认停止" : "确认开始扫描"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
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
      <Button type="button" size="sm" disabled={!canStart} onClick={() => onStart("history")}>
        开始扫描
      </Button>
    );
  }

  if (historyCompleted) {
    return (
      <>
        <Button type="button" size="sm" disabled={!canStart} onClick={() => onStart("latest_refresh", true)}>
          补充最新推文
        </Button>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={!canStart}
          onClick={() => onStart("from_start", true)}
        >
          从头扫描/补断层
        </Button>
      </>
    );
  }

  if (latestRefreshCompleted) {
    return (
      <Button type="button" size="sm" disabled={!canStart} onClick={() => onStart("latest_refresh", true)}>
        再次补充最新推文
      </Button>
    );
  }

  return (
    <>
      {activeMode === "latest_refresh" ? (
        <Button type="button" size="sm" disabled={!canStart} onClick={() => onStart("latest_refresh")}>
          继续补充最新推文
        </Button>
      ) : null}
      {activeMode === "from_start" ? (
        <Button type="button" size="sm" disabled={!canStart} onClick={() => onStart("from_start")}>
          继续从头扫描/补断层
        </Button>
      ) : null}
      <Button type="button" size="sm" disabled={!canStart} onClick={() => onStart("history")}>
        {activeMode === "history" ? "继续历史扫描" : "继续扫描历史"}
      </Button>
      <Button
        type="button"
        size="sm"
        variant="secondary"
        disabled={!canStart}
        onClick={() => onStart("latest_refresh", true)}
      >
        补充最新推文
      </Button>
    </>
  );
}
