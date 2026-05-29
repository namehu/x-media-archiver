import { useEffect, useState } from "react";
import { Button } from "../../../components/ui-next/button";
import { Card, CardContent, CardHeader, CardTitle } from "../../../components/ui-next/card";
import { Input } from "../../../components/ui-next/input";
import { Select } from "../../../components/ui-next/select";
import { inferSourceType, SOURCE_TYPES, type TFunction } from "../utils";

export function CreateSource({
  t,
  isPending,
  error,
  resetKey,
  onCreate,
}: {
  t: TFunction;
  isPending: boolean;
  error: unknown;
  resetKey: number;
  onCreate: (input: { sourceType: string; sourceUrl: string; label?: string }) => void;
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
    <Card>
      <CardHeader>
        <CardTitle>{t("sources.createTitle")}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3 lg:grid-cols-[180px_1fr_220px_auto]">
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
        <Button
          type="button"
          disabled={!canCreate}
          onClick={() => onCreate({ sourceType, sourceUrl, label })}
        >
          {t("sources.create")}
        </Button>
        {error ? <p className="text-sm text-danger lg:col-span-4">{String(error)}</p> : null}
      </CardContent>
    </Card>
  );
}
