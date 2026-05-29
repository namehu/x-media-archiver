import type { ReactNode } from "react";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { cn } from "./_utils/cn";
import { Card, CardContent } from "./card";
import { Sparkline } from "./sparkline";

type Tone = "brand" | "success" | "warning" | "danger";

const toneClass: Record<Tone, string> = {
  brand: "text-brand bg-brand-soft",
  success: "text-success bg-success/10",
  warning: "text-warning bg-warning/10",
  danger: "text-danger bg-danger/10",
};

export function StatCard({
  label,
  value,
  detail,
  icon,
  sparklineData,
  trend,
  tone = "brand",
}: {
  label: string;
  value: string | number;
  detail?: string;
  icon?: ReactNode;
  sparklineData?: number[];
  trend?: { value: string; direction: "up" | "down" | "flat" };
  tone?: Tone;
}) {
  const TrendIcon = trend?.direction === "down" ? ArrowDownRight : ArrowUpRight;
  return (
    <Card className="group hover:border-border-strong hover:shadow-2">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-medium text-fg-secondary">{label}</div>
            <div className="mt-2 text-3xl font-bold tabular-nums tracking-tight text-fg-primary">{value}</div>
          </div>
          {icon ? <div className={cn("rounded-lg p-2", toneClass[tone])}>{icon}</div> : null}
        </div>
        <div className="mt-3 flex min-h-9 items-end justify-between gap-3">
          <div className="min-w-0">
            {trend ? (
              <div className={cn("inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-semibold", toneClass[tone])}>
                {trend.direction === "flat" ? null : <TrendIcon className="h-3 w-3" />}
                {trend.value}
              </div>
            ) : null}
            {detail ? <div className="mt-1 truncate text-xs text-fg-tertiary">{detail}</div> : null}
          </div>
          {sparklineData ? <Sparkline data={sparklineData} /> : null}
        </div>
      </CardContent>
    </Card>
  );
}
