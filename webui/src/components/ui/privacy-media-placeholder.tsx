import { EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";

export function PrivacyMediaPlaceholder({
  className,
  appearance = "default",
  compact = false,
}: {
  className?: string;
  appearance?: "default" | "inverse";
  compact?: boolean;
}) {
  return (
    <div
      data-media-hidden="true"
      role="img"
      aria-label="媒体已隐藏"
      className={cn(
        "flex size-full flex-col items-center justify-center gap-2 text-center",
        appearance === "inverse"
          ? "bg-black text-white/70"
          : "bg-[linear-gradient(135deg,hsl(var(--bg-muted)),hsl(var(--bg-surface)))] text-fg-tertiary",
        className,
      )}
    >
      <EyeOff className={compact ? "size-5" : "size-7"} strokeWidth={1.8} aria-hidden="true" />
      {compact ? null : <span className="text-sm font-medium">媒体已隐藏</span>}
    </div>
  );
}
