import type { ArchiveSourceDetail, ArchiveSubmission } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ActionBlock } from "./action-block";
import { ErrorLine } from "./error-line";
import { FeedbackLine } from "./feedback-line";
import { useNumberInput } from "./use-number-input";

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

export function DownloadActions({
  source,
  actions,
  feedback,
}: {
  source: ArchiveSourceDetail;
  actions: DetailActions;
  feedback: ArchiveSubmission | null;
}) {
  const submitLimit = useNumberInput("20");
  const canSubmit = (source.unsubmitted_tweet_count || 0) > 0 && !actions.pending.submitDiscovered;

  return (
    <ActionBlock
      title="提交下载"
      hint="仅将已经发现但尚未下载的 Tweet 提交处理，不会继续扫描来源。"
      contentClassName="flex flex-col gap-3"
    >
      <Field>
        <FieldLabel htmlFor="source-submit-limit">本次提交数量</FieldLabel>
        <Input
          id="source-submit-limit"
          className="w-32"
          type="number"
          min={1}
          max={500}
          value={submitLimit.value}
          onChange={submitLimit.onChange}
        />
        <FieldDescription>最多提交 500 条已发现记录。</FieldDescription>
      </Field>
      <Button
        type="button"
        className="self-start"
        disabled={!canSubmit}
        onClick={() => actions.submitDiscovered({ sourceId: source.id, limit: submitLimit.clamped(500) })}
      >
        提交待下载发现项
      </Button>
      {actions.errors.submitDiscovered ? <ErrorLine error={actions.errors.submitDiscovered} /> : null}
      {feedback ? <FeedbackLine feedback={feedback} /> : null}
    </ActionBlock>
  );
}
