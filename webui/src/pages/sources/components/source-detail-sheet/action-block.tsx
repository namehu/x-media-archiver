import * as React from "react";
import { HelpCircle } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export function ActionBlock({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3 rounded-lg border border-border-subtle p-3">
      <div className="flex items-center gap-1.5">
        <span className="text-sm font-semibold text-fg-primary">{title}</span>
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
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}
