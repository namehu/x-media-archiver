import * as React from "react";
import { cn } from "./_utils/cn";

export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "animate-shimmer rounded-md bg-[linear-gradient(90deg,hsl(var(--bg-muted)),hsl(var(--border-subtle)),hsl(var(--bg-muted)))] bg-[length:200%_100%]",
        className,
      )}
      {...props}
    />
  );
}
