import { useState } from "react";
import { Film, ImageOff, Image as ImageIcon } from "lucide-react";
import { Badge } from "./badge";
import { cn } from "./_utils/cn";

export function MediaThumbnail({
  src,
  alt,
  mediaType,
  className,
  onClick,
}: {
  src?: string | null;
  alt: string;
  mediaType?: string | null;
  className?: string;
  onClick?: () => void;
}) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const isVideo = mediaType === "video" || Boolean(src?.match(/\.(mp4|mov|m4v|webm)(\?|$)/i));

  return (
    <button
      type="button"
      disabled={!onClick}
      onClick={onClick}
      className={cn(
        "group relative flex aspect-video w-full overflow-hidden rounded-lg bg-bg-muted text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/50",
        className,
      )}
    >
      {src && !failed ? (
        isVideo ? (
          <video
            className={cn("h-full w-full object-cover transition duration-base", loaded ? "opacity-100" : "opacity-0")}
            src={src}
            muted
            preload="metadata"
            onLoadedData={() => setLoaded(true)}
            onError={() => setFailed(true)}
          />
        ) : (
          <img
            className={cn("h-full w-full object-cover transition duration-base group-hover:scale-[1.02]", loaded ? "opacity-100" : "opacity-0")}
            src={src}
            loading="lazy"
            alt={alt}
            onLoad={() => setLoaded(true)}
            onError={() => setFailed(true)}
          />
        )
      ) : null}
      {(!src || failed || !loaded) && (
        <div className="absolute inset-0 flex items-center justify-center bg-[linear-gradient(135deg,hsl(var(--bg-muted)),hsl(var(--border-subtle)))] text-fg-tertiary">
          {failed || !src ? <ImageOff className="h-6 w-6" /> : <ImageIcon className="h-6 w-6 animate-breathe" />}
        </div>
      )}
      {src && !failed ? (
        <div className="absolute left-2 top-2">
          <Badge tone={isVideo ? "default" : "secondary"} className="gap-1 bg-bg-elevated/90 backdrop-blur">
            {isVideo ? <Film className="h-3 w-3" /> : <ImageIcon className="h-3 w-3" />}
            {isVideo ? "Video" : "Photo"}
          </Badge>
        </div>
      ) : null}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/35 to-transparent opacity-0 transition duration-base group-hover:opacity-100" />
    </button>
  );
}
