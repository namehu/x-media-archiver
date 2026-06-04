import type { ArchiveSubmission } from "@/lib/api";

export function FeedbackLine({ feedback }: { feedback: ArchiveSubmission }) {
  return (
    <p className="basis-full rounded-lg bg-bg-muted p-3 text-sm text-fg-primary">
      Run #{feedback.run_id} · {feedback.tasks.queued_count} 个已入队 · {feedback.tasks.skipped_verified_count} 个已归档
      · {feedback.tasks.linked_pending_count} 个已有任务
    </p>
  );
}
