import type { ReactNode } from "react";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardDescription, CardHeader } from "./card";
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
      <CardHeader className="flex-row items-start justify-between gap-3 p-4 pb-0">
        <CardDescription className="font-medium">{label}</CardDescription>
        {icon ? <div className={cn("flex size-9 items-center justify-center rounded-lg [&>svg]:size-4", toneClass[tone])}>{icon}</div> : null}
      </CardHeader>
      <CardContent className="p-4 pt-2">
        <div className="text-3xl font-bold tabular-nums tracking-tight text-fg-primary">{value}</div>
        <div className="mt-3 flex min-h-8 items-end justify-between gap-3">
          <div className="min-w-0 flex-1">
            {trend ? (
              <div className={cn("inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-semibold", toneClass[tone])}>
                {trend.direction === "flat" ? null : <TrendIcon className="size-3" />}
                {trend.value}
              </div>
            ) : null}
            {detail ? <div className="mt-1 text-xs text-fg-tertiary">{detail}</div> : null}
          </div>
          {sparklineData ? <Sparkline data={sparklineData} /> : null}
        </div>
      </CardContent>
    </Card>
  );
}
