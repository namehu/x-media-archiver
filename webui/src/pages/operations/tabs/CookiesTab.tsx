import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Save, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "../../../components/ui/badge";
import { Button } from "../../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../components/ui/card";
import { Input } from "../../../components/ui/input";
import { apiDelete, apiGet, apiPost, type CookieConfig } from "../../../lib/api";
import { useI18n } from "../../../lib/i18n";
import { formatDateTime } from "../../../lib/utils";
import { errorMessage } from "../utils";

export function CookiesTab() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [content, setContent] = useState("");
  const [label, setLabel] = useState("");

  const configQuery = useQuery({
    queryKey: ["settings-cookies"],
    queryFn: () => apiGet<CookieConfig>("/api/v1/settings/cookies"),
  });

  const saveMutation = useMutation({
    mutationFn: () => apiPost<CookieConfig>("/api/v1/settings/cookies", { content, label: label || null }),
    onSuccess: async () => {
      setContent("");
      toast.success(t("operations.cookiesSaved"));
      await queryClient.invalidateQueries({ queryKey: ["settings-cookies"] });
    },
    onError: (error) => toast.error(t("operations.cookiesSaveFailed", { error: errorMessage(error) })),
  });

  const clearMutation = useMutation({
    mutationFn: () => apiDelete<CookieConfig>("/api/v1/settings/cookies"),
    onSuccess: async () => {
      setContent("");
      setLabel("");
      toast.success(t("operations.cookiesCleared"));
      await queryClient.invalidateQueries({ queryKey: ["settings-cookies"] });
    },
    onError: (error) => toast.error(t("operations.cookiesClearFailed", { error: errorMessage(error) })),
  });

  const pending = saveMutation.isPending || clearMutation.isPending;
  const status = configQuery.data;

  async function handleFileChange(file: File | null) {
    if (!file) return;
    setContent(await file.text());
    setLabel(file.name);
  }

  return (
    <section className="grid gap-4 xl:grid-cols-[0.8fr_1.2fr]">
      <Card>
        <CardHeader>
          <CardTitle>{t("operations.cookiesStatus")}</CardTitle>
          <CardDescription>{t("operations.cookiesStatusHint")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between gap-3 rounded-md border border-border-subtle bg-bg-surface px-3 py-2 text-sm">
            <span className="text-fg-secondary">{t("operations.cookiesConfigured")}</span>
            <Badge tone={status?.configured ? "success" : "warning"}>
              {status?.configured ? t("operations.cookiesConfiguredYes") : t("operations.cookiesConfiguredNo")}
            </Badge>
          </div>
          <InfoRow label={t("operations.cookiesSource")} value={status ? t(`operations.cookiesSource.${status.source}`) : "-"} />
          <InfoRow label={t("operations.cookiesLabel")} value={status?.label || "-"} />
          <InfoRow label={t("operations.cookiesUpdatedAt")} value={formatDateTime(status?.updated_at)} />
          <Button type="button" variant="destructive" disabled={pending || status?.source !== "database"} onClick={() => clearMutation.mutate()}>
            <Trash2 className="h-4 w-4" />
            {t("operations.cookiesClear")}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("operations.cookiesUpdate")}</CardTitle>
          <CardDescription>{t("operations.cookiesUpdateHint")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-[1fr_auto]">
            <Input value={label} placeholder={t("operations.cookiesLabelPlaceholder")} onChange={(event) => setLabel(event.target.value)} />
            <label className="inline-flex h-9 cursor-pointer items-center justify-center gap-2 rounded-md border border-border-subtle bg-bg-muted px-4 text-sm font-medium text-fg-primary hover:border-border-strong hover:bg-bg-surface">
              <Upload className="h-4 w-4" />
              {t("operations.cookiesUpload")}
              <input className="sr-only" type="file" accept=".txt,text/plain" onChange={(event) => void handleFileChange(event.target.files?.[0] ?? null)} />
            </label>
          </div>
          <textarea
            className="min-h-72 w-full resize-y rounded-md border border-border-strong bg-bg-elevated p-3 font-mono text-xs text-fg-primary outline-none transition duration-fast placeholder:text-fg-tertiary focus-visible:ring-2 focus-visible:ring-brand/50"
            value={content}
            spellCheck={false}
            placeholder={t("operations.cookiesPlaceholder")}
            onChange={(event) => setContent(event.target.value)}
          />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-fg-secondary">{t("operations.cookiesSecretHint")}</p>
            <Button type="button" disabled={pending || !content.trim()} onClick={() => saveMutation.mutate()}>
              <Save className="h-4 w-4" />
              {t("operations.cookiesSave")}
            </Button>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 text-sm">
      <span className="text-fg-secondary">{label}</span>
      <span className="max-w-[65%] truncate text-right font-medium text-fg-primary">{value}</span>
    </div>
  );
}
