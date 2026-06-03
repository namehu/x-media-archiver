import { useEffect, useState } from "react";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Select } from "../../../components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../../../components/ui/dialog";
import { useI18n } from "../../../lib/i18n";
import { inferSourceType, SOURCE_TYPES } from "../utils";

export function CreateSource({
  open,
  isPending,
  error,
  resetKey,
  onCreate,
  onOpenChange,
}: {
  open: boolean;
  isPending: boolean;
  error: unknown;
  resetKey: number;
  onCreate: (input: { sourceType: string; sourceUrl: string; label?: string }) => void;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useI18n();
  const [sourceType, setSourceType] = useState("profile");
  const [sourceUrl, setSourceUrl] = useState("");
  const [label, setLabel] = useState("");
  const canCreate = sourceUrl.trim().length > 0 && !isPending;

  useEffect(() => {
    setSourceUrl("");
    setLabel("");
  }, [resetKey]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("sources.createTitle")}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <label className="space-y-1">
            <Select value={sourceType} onChange={(event) => setSourceType(event.target.value)}>
              {SOURCE_TYPES.map((type) => (
                <option key={type} value={type}>
                  {t(`sources.type.${type}`)}
                </option>
              ))}
            </Select>
            <span className="block text-xs text-fg-tertiary" title={t("sources.typeHelpTooltip")}>
              {t("sources.typeHelp")}
            </span>
          </label>
          <Input
            placeholder="https://x.com/username/media"
            value={sourceUrl}
            onChange={(event) => {
              const nextUrl = event.target.value;
              setSourceUrl(nextUrl);
              const inferred = inferSourceType(nextUrl);
              if (inferred) setSourceType(inferred);
            }}
          />
          <Input placeholder={t("sources.label")} value={label} onChange={(event) => setLabel(event.target.value)} />
          {error ? <p className="text-sm text-danger">{String(error)}</p> : null}
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              关闭
            </Button>
            <Button type="button" disabled={!canCreate} onClick={() => onCreate({ sourceType, sourceUrl, label })}>
              {t("sources.create")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}


