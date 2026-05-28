import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiPost, type ActionResponse } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { Button } from "../components/ui/Button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/Card";
import { Input } from "../components/ui/Input";
import { Select } from "../components/ui/Select";

export function OperationsPage() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [verifyLimit, setVerifyLimit] = useState("");
  const [confirmFullScan, setConfirmFullScan] = useState(false);
  const [requeueStatuses, setRequeueStatuses] = useState(["failed_retryable", "missing", "corrupt"]);
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
            <CardTitle>{t("operations.requeue")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-2">
              <div className="text-sm font-medium">{t("operations.requeueStatuses")}</div>
              {["failed_retryable", "missing", "corrupt", "failed_permanent"].map((status) => (
                <label key={status} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={requeueStatuses.includes(status)}
                    onChange={(event) => {
                      setRequeueStatuses((current) =>
                        event.target.checked ? [...current, status] : current.filter((item) => item !== status),
                      );
                    }}
                  />
                  {t(`common.status.${status}`)}
                </label>
              ))}
            </div>
            <Input
              placeholder={t("operations.limit")}
              inputMode="numeric"
              value={requeueLimit}
              onChange={(event) => setRequeueLimit(event.target.value)}
            />
            <Button
              type="button"
              disabled={mutation.isPending}
              onClick={() =>
                run("/api/v1/actions/requeue", {
                  statuses: requeueStatuses.length ? requeueStatuses : null,
                  limit: numberOrNull(requeueLimit),
                })
              }
            >
              {t("operations.requeue")}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("operations.recoverInterrupted")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Input
              placeholder={t("operations.timeoutMinutes")}
              inputMode="numeric"
              value={recoverTimeout}
              onChange={(event) => setRecoverTimeout(event.target.value)}
            />
            <Button
              type="button"
              disabled={mutation.isPending}
              onClick={() =>
                run("/api/v1/actions/recover-interrupted", {
                  timeout_minutes: numberOrNull(recoverTimeout),
                })
              }
            >
              {t("operations.recover")}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("operations.export")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Select value={exportKind} onChange={(event) => setExportKind(event.target.value)}>
              <option value="media">{t("operations.exportMedia")}</option>
              <option value="failures">{t("operations.exportFailures")}</option>
              <option value="duplicates">{t("operations.exportDuplicates")}</option>
            </Select>
            <Select value={exportStatus} onChange={(event) => setExportStatus(event.target.value)}>
              <option value="verified">{t("common.status.verified")}</option>
              <option value="all">{t("common.status.all")}</option>
              <option value="downloaded">{t("common.status.downloaded")}</option>
              <option value="missing">{t("common.status.missing")}</option>
              <option value="corrupt">{t("common.status.corrupt")}</option>
            </Select>
            <Button
              type="button"
              disabled={mutation.isPending}
              onClick={() => run("/api/v1/actions/export", { kind: exportKind, status: exportStatus })}
            >
              {t("operations.exportSnapshot")}
            </Button>
          </CardContent>
        </Card>
      </section>

      <Card>
        <CardHeader>
          <CardTitle>{t("operations.maintenance")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-destructive">
            {t("operations.fullScanWarning")}
          </p>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={confirmFullScan}
              onChange={(event) => setConfirmFullScan(event.target.checked)}
            />
            {t("operations.confirmFullScan")}
          </label>
          <div className="grid gap-3 md:grid-cols-[1fr_auto_auto]">
            <Input
              placeholder={t("operations.verifyLimit")}
              inputMode="numeric"
              value={verifyLimit}
              onChange={(event) => setVerifyLimit(event.target.value)}
            />
            <Button
              type="button"
              variant="secondary"
              disabled={mutation.isPending || !confirmFullScan}
              onClick={() =>
                run("/api/v1/maintenance/verify", {
                  limit: numberOrNull(verifyLimit),
                  confirm_full_scan: confirmFullScan,
                })
              }
            >
              {t("operations.fullVerify")}
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={mutation.isPending || !confirmFullScan}
              onClick={() =>
                run("/api/v1/maintenance/backfill", {
                  confirm_full_scan: confirmFullScan,
                  normalize_files: true,
                })
              }
            >
              {t("operations.fullBackfill")}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {t("operations.exportNote")}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("operations.result")}</CardTitle>
        </CardHeader>
        <CardContent>
          {mutation.error ? (
            <pre className="overflow-auto rounded-md bg-muted p-3 text-sm text-destructive">
              {String(mutation.error)}
            </pre>
          ) : null}
          {mutation.isPending ? <p className="text-sm text-muted-foreground">{t("operations.running")}</p> : null}
          {lastResult ? (
            <pre className="overflow-auto rounded-md bg-muted p-3 text-sm">
              {JSON.stringify(lastResult, null, 2)}
            </pre>
          ) : null}
          {!lastResult && !mutation.error && !mutation.isPending ? (
            <p className="text-sm text-muted-foreground">{t("operations.noResult")}</p>
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
