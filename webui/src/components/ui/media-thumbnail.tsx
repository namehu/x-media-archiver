import { useEffect, useState, type MouseEventHandler } from "react";
import { Film, ImageOff, Image as ImageIcon } from "lucide-react";
import { Badge } from "./badge";
import { PrivacyMediaPlaceholder } from "./privacy-media-placeholder";
import { cn } from "@/lib/utils";
import { usePrivacyRedactionEnabled } from "@/lib/privacy-redaction";

export function MediaThumbnail({
  src,
  fallbackSrc,
  alt,
  mediaType,
  className,
  onClick,
  fit = "cover",
  aspect = "video",
  showTypeBadge = true,
  ariaLabel,
}: {
  src?: string | null;
  fallbackSrc?: string | null;
  alt: string;
  mediaType?: string | null;
  className?: string;
  onClick?: MouseEventHandler<HTMLButtonElement>;
  fit?: "cover" | "contain";
  aspect?: "video" | "square" | "wide";
  showTypeBadge?: boolean;
  ariaLabel?: string;
}) {
  const privacyRedactionEnabled = usePrivacyRedactionEnabled();
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [activeSrc, setActiveSrc] = useState(src || fallbackSrc || null);
  const isVideo = mediaType === "video" || Boolean((src || fallbackSrc)?.match(/\.(mp4|mov|m4v|webm)(\?|$)/i));

  useEffect(() => {
    setLoaded(false);
    setFailed(false);
    setActiveSrc(src || fallbackSrc || null);
  }, [fallbackSrc, src]);

  return (
    <button
      type="button"
      disabled={!onClick || privacyRedactionEnabled}
      onClick={privacyRedactionEnabled ? undefined : onClick}
      aria-label={ariaLabel || alt}
      className={cn(
        "group relative flex w-full overflow-hidden rounded-lg bg-bg-muted text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/50",
        aspect === "square" ? "aspect-square" : aspect === "wide" ? "aspect-[3/1]" : "aspect-video",
        className,
      )}
    >
      {privacyRedactionEnabled ? (
        <PrivacyMediaPlaceholder />
      ) : activeSrc && !failed ? (
        <img
          className={cn(
            "h-full w-full transition duration-base",
            fit === "contain" ? "object-contain" : "object-cover group-hover:scale-[1.02]",
            loaded ? "opacity-100" : "opacity-0",
          )}
          src={activeSrc}
          loading="lazy"
          decoding="async"
          alt={alt}
          onLoad={() => setLoaded(true)}
          onError={() => {
            if (fallbackSrc && activeSrc !== fallbackSrc) {
              setLoaded(false);
              setActiveSrc(fallbackSrc);
              return;
            }
            setFailed(true);
          }}
        />
      ) : null}
      {!privacyRedactionEnabled && (!activeSrc || failed || !loaded) && (
        <div className="absolute inset-0 flex items-center justify-center bg-[linear-gradient(135deg,hsl(var(--bg-muted)),hsl(var(--border-subtle)))] text-fg-tertiary">
          {failed || !activeSrc ? (
            isVideo ? <Film className="h-6 w-6" /> : <ImageOff className="h-6 w-6" />
          ) : (
            <ImageIcon className="h-6 w-6 animate-breathe" />
          )}
        </div>
      )}
      {!privacyRedactionEnabled && activeSrc && !failed && showTypeBadge ? (
        <div className="absolute left-2 top-2">
          <Badge tone={isVideo ? "default" : "secondary"} className="gap-1 bg-bg-elevated/90 backdrop-blur">
            {isVideo ? <Film className="h-3 w-3" /> : <ImageIcon className="h-3 w-3" />}
            {isVideo ? "Video" : "Photo"}
          </Badge>
        </div>
      ) : null}
      {privacyRedactionEnabled ? null : (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/35 to-transparent opacity-0 transition duration-base group-hover:opacity-100" />
      )}
    </button>
  );
}
