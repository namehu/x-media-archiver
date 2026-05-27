import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiPost, type ActionResponse } from "../lib/api";
import { Button } from "../components/ui/Button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/Card";
import { Input } from "../components/ui/Input";
import { Select } from "../components/ui/Select";

export function OperationsPage() {
  const queryClient = useQueryClient();
  const [verifyLimit, setVerifyLimit] = useState("");
  const [confirmFullScan, setConfirmFullScan] = useState(false);
  const [requeueStatuses, setRequeueStatuses] = useState("failed_retryable,missing,corrupt");
  const [requeueLimit, setRequeueLimit] = useState("");
  const [recoverTimeout, setRecoverTimeout] = useState("");
  const [exportKind, setExportKind] = useState("media");
  const [exportStatus, setExportStatus] = useState("verified");
  const [lastResult, setLastResult] = useState<ActionResponse | null>(null);

  const mutation = useMutation({
    mutationFn: ({ path, body }: { path: string; body: unknown }) => apiPost<ActionResponse>(path, body),
    onSuccess: async (result) => {
      setLastResult(result);
      await queryClient.invalidateQueries();
    },
  });

  const run = (path: string, body: Record<string, unknown> = {}) => {
    mutation.mutate({ path, body });
  };

  return (
    <div className="space-y-5">
      <section className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Requeue</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Input value={requeueStatuses} onChange={(event) => setRequeueStatuses(event.target.value)} />
            <Input
              placeholder="Limit"
              inputMode="numeric"
              value={requeueLimit}
              onChange={(event) => setRequeueLimit(event.target.value)}
            />
            <Button
              type="button"
              disabled={mutation.isPending}
              onClick={() =>
                run("/api/actions/requeue", {
                  statuses: listOrNull(requeueStatuses),
                  limit: numberOrNull(requeueLimit),
                })
              }
            >
              Requeue
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recover Interrupted</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Input
              placeholder="Timeout minutes"
              inputMode="numeric"
              value={recoverTimeout}
              onChange={(event) => setRecoverTimeout(event.target.value)}
            />
            <Button
              type="button"
              disabled={mutation.isPending}
              onClick={() =>
                run("/api/actions/recover-interrupted", {
                  timeout_minutes: numberOrNull(recoverTimeout),
                })
              }
            >
              Recover
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Export</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Select value={exportKind} onChange={(event) => setExportKind(event.target.value)}>
              <option value="media">media CSV</option>
              <option value="failures">failures CSV</option>
              <option value="duplicates">duplicates CSV</option>
            </Select>
            <Select value={exportStatus} onChange={(event) => setExportStatus(event.target.value)}>
              <option value="verified">verified</option>
              <option value="all">all statuses</option>
              <option value="downloaded">downloaded</option>
              <option value="missing">missing</option>
              <option value="corrupt">corrupt</option>
            </Select>
            <Button
              type="button"
              disabled={mutation.isPending}
              onClick={() => run("/api/actions/export", { kind: exportKind, status: exportStatus })}
            >
              Export database snapshot
            </Button>
          </CardContent>
        </Card>
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Maintenance</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-destructive">
            These operations scan files across the entire archive and may cause heavy disk I/O on large libraries.
          </p>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={confirmFullScan}
              onChange={(event) => setConfirmFullScan(event.target.checked)}
            />
            I understand this is a full archive disk scan.
          </label>
          <div className="grid gap-3 md:grid-cols-[1fr_auto_auto]">
            <Input
              placeholder="Verify limit (optional)"
              inputMode="numeric"
              value={verifyLimit}
              onChange={(event) => setVerifyLimit(event.target.value)}
            />
            <Button
              type="button"
              variant="secondary"
              disabled={mutation.isPending || !confirmFullScan}
              onClick={() =>
                run("/api/maintenance/verify", {
                  limit: numberOrNull(verifyLimit),
                  confirm_full_scan: confirmFullScan,
                })
              }
            >
              Full file verification
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={mutation.isPending || !confirmFullScan}
              onClick={() =>
                run("/api/maintenance/backfill", {
                  confirm_full_scan: confirmFullScan,
                  normalize_files: true,
                })
              }
            >
              Full media backfill
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            CSV export above reads the database snapshot and does not scan media file contents.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Result</CardTitle>
        </CardHeader>
        <CardContent>
          {mutation.error ? (
            <pre className="overflow-auto rounded-md bg-muted p-3 text-sm text-destructive">
              {String(mutation.error)}
            </pre>
          ) : null}
          {mutation.isPending ? <p className="text-sm text-muted-foreground">Running...</p> : null}
          {lastResult ? (
            <pre className="overflow-auto rounded-md bg-muted p-3 text-sm">
              {JSON.stringify(lastResult, null, 2)}
            </pre>
          ) : null}
          {!lastResult && !mutation.error && !mutation.isPending ? (
            <p className="text-sm text-muted-foreground">No operation has run yet.</p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

function numberOrNull(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function listOrNull(value: string) {
  const items = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return items.length ? items : null;
}
