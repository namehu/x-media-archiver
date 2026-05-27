import type { SelectHTMLAttributes } from "react";
import { cn } from "../../lib/utils";

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        "h-9 w-full rounded-md border border-border bg-white px-3 text-sm outline-none transition-colors focus:border-primary",
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
}

