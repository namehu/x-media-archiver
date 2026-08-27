import * as React from "react";
import { HelpCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
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
    <div className="flex h-full flex-col gap-3 rounded-xl border border-border-subtle bg-bg-base p-4">
      <div className="flex items-center gap-1.5">
        <span className="font-semibold text-fg-primary">{title}</span>
        {hint ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button type="button" size="icon" variant="ghost" className="size-8" aria-label={`查看“${title}”说明`}>
                <HelpCircle aria-hidden="true" />
              </Button>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs">{hint}</TooltipContent>
          </Tooltip>
        ) : null}
      </div>
      <div className={contentClassName}>{children}</div>
    </div>
  );
}
