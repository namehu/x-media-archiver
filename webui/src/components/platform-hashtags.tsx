import { Hash } from "lucide-react";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { getDebugRedactProps, useDebugRedactionEnabled } from "@/lib/debug-redaction";
import { cn } from "@/lib/utils";

type PlatformHashtagsProps = {
  hashtags?: string[];
  appearance?: "default" | "inverse";
  className?: string;
};

export function PlatformHashtags({
  hashtags = [],
  appearance = "default",
  className,
}: PlatformHashtagsProps) {
  const debugRedactionEnabled = useDebugRedactionEnabled();
  if (!hashtags.length) return null;

  const inverse = appearance === "inverse";

  return (
    <div
      role="group"
      className={cn("flex flex-wrap items-center gap-1.5", className)}
      aria-label="平台 Hashtag"
      {...getDebugRedactProps(debugRedactionEnabled)}
    >
      <span
        className={cn(
          "inline-flex items-center gap-1 text-xs font-semibold",
          inverse ? "text-white/70" : "text-fg-secondary",
        )}
      >
        <Hash className="size-3.5" aria-hidden="true" />
        平台 Hashtag
      </span>
      {hashtags.map((hashtag, index) => {
        const badge = (
          <Badge
            tone={inverse ? "secondary" : "default"}
            className={cn(
              "max-w-56 truncate transition-colors",
              inverse && "border-white/20 bg-white/10 text-white hover:bg-white/20",
              !inverse && "hover:border-brand/35 hover:bg-brand/15",
            )}
          >
            #{hashtag}
          </Badge>
        );

        if (debugRedactionEnabled) return <span key={`${hashtag}:${index}`}>{badge}</span>;

        return (
          <Link
            key={`${hashtag}:${index}`}
            to={platformHashtagSearchHref(hashtag)}
            aria-label={`搜索平台 Hashtag #${hashtag}`}
            className="rounded-md outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
            onClick={(event) => event.stopPropagation()}
          >
            {badge}
          </Link>
        );
      })}
    </div>
  );
}

export function platformHashtagSearchHref(hashtag: string) {
  const params = new URLSearchParams({ hashtag, tweet_status: "all" });
  return `/search?${params.toString()}`;
}
