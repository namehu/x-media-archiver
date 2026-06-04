import type { SourceScanRun } from "@/lib/api";
import { scanTriggerLabel, scanStatusLabel } from "@/lib/formatters";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScanLogBox } from "./scan-log-box";

export function ScanLogDialog({
  run,
  onOpenChange,
}: {
  run: SourceScanRun | null;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={Boolean(run)} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[82vh] overflow-hidden sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {run ? `${scanTriggerLabel(run.trigger_type)} #${run.id} · ${scanStatusLabel(run.status)}` : "扫描日志"}
          </DialogTitle>
        </DialogHeader>
        {run ? (
          <div className="min-h-0 overflow-auto">
            <ScanLogBox run={run} />
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
