import { useEffect, useState } from "react";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Select } from "../../../components/ui/select";
import { DialogHeader, DialogTitle } from "../../../components/ui/dialog";
import { inferSourceType, SOURCE_TYPES, type TFunction } from "../utils";

export function CreateSource({
  t,
  isPending,
  error,
  resetKey,
  onCreate,
  onClose,
}: {
  t: TFunction;
  isPending: boolean;
  error: unknown;
  resetKey: number;
  onCreate: (input: { sourceType: string; sourceUrl: string; label?: string }) => void;
  onClose?: () => void;
}) {
  const [sourceType, setSourceType] = useState("profile");
  const [sourceUrl, setSourceUrl] = useState("");
  const [label, setLabel] = useState("");
  const canCreate = sourceUrl.trim().length > 0 && !isPending;

  useEffect(() => {
    setSourceUrl("");
    setLabel("");
  }, [resetKey]);

  return (
    <div className="space-y-4">
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
          {onClose ? (
            <Button type="button" variant="secondary" onClick={onClose}>
              关闭
            </Button>
          ) : null}
          <Button
            type="button"
            disabled={!canCreate}
            onClick={() => onCreate({ sourceType, sourceUrl, label })}
          >
            {t("sources.create")}
          </Button>
        </div>
      </div>
    </div>
  );
}
