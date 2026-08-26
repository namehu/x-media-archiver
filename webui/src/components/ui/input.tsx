import * as React from "react";
import { cn } from "@/lib/utils";

export type InputProps = React.InputHTMLAttributes<HTMLInputElement> & {
  appearance?: "default" | "search";
};

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ appearance = "default", className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "h-10 w-full rounded-lg border border-border-strong bg-bg-elevated px-3 text-[16px] text-fg-primary outline-none transition duration-fast placeholder:text-fg-tertiary focus-visible:ring-2 focus-visible:ring-brand/50 sm:text-sm disabled:cursor-not-allowed disabled:opacity-50",
        appearance === "search" && "rounded-full border-transparent bg-bg-muted px-4 hover:border-border-subtle",
        className,
      )}
      {...props}
    />
  ),
);

Input.displayName = "Input";
