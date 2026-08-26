import { cn } from "@/lib/utils";
import { StatusDot } from "./status-dot";

type LiveState = "connecting" | "open" | "reconnecting" | "closed";

export function LiveIndicator({
  state,
  label,
  className,
  compactOnMobile = false,
}: {
  state: LiveState;
  label: string;
  className?: string;
  compactOnMobile?: boolean;
}) {
  const online = state === "open";
  return (
    <div
      className={cn(
        "inline-flex min-h-10 items-center gap-2 px-2 text-xs font-medium text-fg-tertiary",
        !online && "text-fg-secondary",
        className,
      )}
      title={label}
      aria-label={label}
      role="status"
      aria-live="polite"
    >
      <StatusDot status={online ? "running" : state === "connecting" ? "warning" : "idle"} />
      <span className={compactOnMobile ? "hidden sm:inline" : undefined}>{label}</span>
    </div>
  );
}
