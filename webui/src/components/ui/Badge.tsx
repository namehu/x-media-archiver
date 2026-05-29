import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "./_utils/cn";

const badgeVariants = cva("inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium", {
  variants: {
    tone: {
      default: "border-brand/20 bg-brand-soft text-brand",
      secondary: "border-border-subtle bg-bg-muted text-fg-secondary",
      success: "border-success/20 bg-success/10 text-success",
      warning: "border-warning/25 bg-warning/10 text-warning",
      danger: "border-danger/20 bg-danger/10 text-danger",
    },
  },
  defaultVariants: {
    tone: "secondary",
  },
});

export type BadgeProps = React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>;

export function Badge({ className, tone, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}
