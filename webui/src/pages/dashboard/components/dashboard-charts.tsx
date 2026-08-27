import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../components/ui/card";
import { cn } from "../../../lib/utils";

export type StatusChartEntry = {
  status: string;
  label: string;
  count: number;
};

export function StatusDistributionCard({
  className,
  title,
  description,
  emptyLabel,
  entries,
}: {
  className?: string;
  title: string;
  description: string;
  emptyLabel: string;
  entries: StatusChartEntry[];
}) {
  const total = entries.reduce((sum, entry) => sum + entry.count, 0);

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        {entries.length === 0 ? (
          <p className="text-sm text-fg-secondary">{emptyLabel}</p>
        ) : (
          <div className="flex flex-col gap-5">
            <div className="flex items-end justify-between gap-4 border-b border-border-subtle pb-4">
              <div>
                <div className="text-3xl font-bold tabular-nums tracking-tight text-fg-primary">{total.toLocaleString()}</div>
                <p className="mt-1 text-xs text-fg-tertiary">Tweet 总数</p>
              </div>
              <p className="text-right text-xs leading-5 text-fg-tertiary">状态数量与占比</p>
            </div>
            <div className="flex flex-col gap-4">
              {entries.map((entry) => {
                const percent = total ? (entry.count / total) * 100 : 0;
                return (
                  <div key={entry.status} className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-between gap-3 text-sm">
                      <span className="font-medium text-fg-primary">{entry.label}</span>
                      <span className="shrink-0 tabular-nums text-fg-secondary">
                        {entry.count.toLocaleString()} · {Math.round(percent)}%
                      </span>
                    </div>
                    <div
                      className="h-2 overflow-hidden rounded-full bg-bg-muted"
                      role="img"
                      aria-label={`${entry.label} ${entry.count.toLocaleString()}，占 ${Math.round(percent)}%`}
                    >
                      <div
                        className={cn("h-full rounded-full", statusBarClass(entry.status))}
                        style={{ width: `${Math.max(percent, entry.count ? 2 : 0)}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function statusBarClass(status: string) {
  if (status.includes("failed") || status.includes("corrupt")) return "bg-danger";
  if (status.includes("missing") || status.includes("pending")) return "bg-warning";
  if (status.includes("verified") || status.includes("completed") || status.includes("downloaded")) return "bg-success";
  return "bg-brand";
}
