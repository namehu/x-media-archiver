import * as React from "react";
import { HelpCircle } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export function ActionBlock({
  title,
  hint,
  children,
  contentClassName = "flex flex-wrap gap-2",
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
  contentClassName?: string;
}) {
  return (
    <div className="flex h-full flex-col space-y-3 rounded-xl bg-bg-muted/40 p-4">
      <div className="flex items-center gap-1.5">
        <span className="font-semibold text-fg-primary">{title}</span>
        {hint ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button type="button" className="text-fg-tertiary hover:text-fg-secondary focus:outline-none">
                <HelpCircle className="h-3.5 w-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs">{hint}</TooltipContent>
          </Tooltip>
        ) : null}
      </div>
      <div className={contentClassName}>{children}</div>
    </div>
  );
}
