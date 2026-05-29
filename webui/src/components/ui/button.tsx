import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "./_utils/cn";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition duration-fast ease-out focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-base disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-brand text-white hover:-translate-y-px hover:bg-brand-hover active:translate-y-0",
        secondary: "border border-border-subtle bg-bg-muted text-fg-primary hover:border-border-strong hover:bg-bg-surface",
        outline: "border border-border-strong bg-transparent text-fg-primary hover:bg-bg-muted",
        ghost: "text-fg-secondary hover:bg-bg-muted hover:text-fg-primary",
        destructive: "bg-danger text-white hover:-translate-y-px hover:brightness-105 active:translate-y-0",
      },
      size: {
        sm: "h-8 px-3",
        md: "h-9 px-4",
        lg: "h-10 px-6",
        icon: "h-9 w-9 p-0",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "md",
    },
  },
);

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants>;

export function Button({ className, variant, size, ...props }: ButtonProps) {
  return <button className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
