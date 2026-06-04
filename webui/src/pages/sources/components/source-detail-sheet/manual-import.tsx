import * as React from "react";
import type { ArchiveSourceDetail, ArchiveSubmission } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { parseRecordUrls } from "../../utils";
import { useTextInput } from "./use-number-input";
import { ActionBlock } from "./action-block";
import { ErrorLine } from "./error-line";
import { FeedbackLine } from "./feedback-line";

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
type ScanMode = "history" | "latest_refresh" | "from_start";

export function ManualImport({
  source,
  actions,
  feedback,
  onSubmitted,
}: {
  source: ArchiveSourceDetail;
  actions: DetailActions;
  feedback: ArchiveSubmission | null;
  onSubmitted: () => void;
}) {
  const recordUrls = useTextInput("");
  const records = parseRecordUrls(recordUrls.value);
  const canSubmit = records.length > 0 && !actions.pending.submit;

  React.useEffect(() => {
    if (feedback) recordUrls.set("");
  }, [feedback?.run_id]);

  return (
    <ActionBlock title="手动粘贴 Tweet URL">
      <textarea
        className="min-h-24 w-full resize-y rounded-md border border-border-strong bg-bg-elevated px-3 py-2 text-sm text-fg-primary outline-none transition duration-fast placeholder:text-fg-tertiary focus-visible:ring-2 focus-visible:ring-brand/50"
        placeholder="https://x.com/user/status/123"
        value={recordUrls.value}
        onChange={recordUrls.onChange}
      />
      <Button
        type="button"
        disabled={!canSubmit}
        onClick={() => {
          actions.submitRecords({ sourceId: source.id, records });
          onSubmitted();
        }}
      >
        提交发现结果
      </Button>
      {actions.errors.submit ? <ErrorLine error={actions.errors.submit} /> : null}
      {feedback ? <FeedbackLine feedback={feedback} /> : null}
    </ActionBlock>
  );
}
