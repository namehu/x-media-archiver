import { cn } from "./_utils/cn";

type StatusTone = "running" | "success" | "warning" | "danger" | "idle";

const toneClass: Record<StatusTone, string> = {
  running: "bg-brand animate-breathe",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  idle: "bg-fg-tertiary",
};

export function StatusDot({ status, className }: { status: StatusTone; className?: string }) {
  return <span className={cn("inline-block h-2 w-2 rounded-full", toneClass[status], className)} aria-hidden="true" />;
}
