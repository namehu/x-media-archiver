import type { MediaRow } from "@/lib/api";
import { mediaTypeLabel, statusLabel } from "@/lib/formatters";
import { formatBytes } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { getPrivacyRedactProps, usePrivacyRedactionEnabled } from "@/lib/privacy-redaction";

export function MediaDetails({ media }: { media: MediaRow }) {
  const privacyRedactionEnabled = usePrivacyRedactionEnabled();
  return (
    <div className="flex flex-col gap-2 px-3 py-2.5 text-sm">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-medium text-fg-primary">{mediaTypeLabel(media.media_type)}</span>
        <span className="text-xs text-fg-secondary">{formatBytes(media.file_size)}</span>
        <span className="text-xs text-fg-secondary">
          {media.width && media.height ? `${media.width} × ${media.height}` : "尺寸未知"}
        </span>
        <Badge className="ml-auto" tone={media.media_status === "verified" ? "success" : "secondary"}>
          {statusLabel(media.media_status)}
        </Badge>
      </div>
      {media.local_path ? (
        <div
          className="min-w-0 break-all text-xs text-fg-tertiary"
          {...getPrivacyRedactProps(privacyRedactionEnabled)}
        >
          {media.local_path}
        </div>
      ) : null}
    </div>
  );
}
