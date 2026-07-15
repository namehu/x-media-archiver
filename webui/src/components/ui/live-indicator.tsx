import { Wifi, WifiOff } from "lucide-react";
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
        "inline-flex items-center gap-2 rounded-md border px-2 py-1 text-xs font-medium",
        online ? "border-brand/25 bg-brand-soft text-brand" : "border-border-subtle bg-bg-muted text-fg-secondary",
        className,
      )}
      title={label}
      aria-label={label}
    >
      {online ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
      <StatusDot status={online ? "running" : state === "connecting" ? "warning" : "idle"} />
      <span className={compactOnMobile ? "hidden sm:inline" : undefined}>{label}</span>
    </div>
  );
}
