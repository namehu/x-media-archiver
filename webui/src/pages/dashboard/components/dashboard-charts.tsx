import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../components/ui/card";

export type StatusChartEntry = {
  status: string;
  label: string;
  count: number;
};

const CHART_COLORS = [
  "hsl(var(--brand))",
  "hsl(var(--accent))",
  "hsl(var(--success))",
  "hsl(var(--warning))",
  "hsl(var(--danger))",
  "hsl(var(--fg-tertiary))",
];

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
          <div className="grid items-center gap-6 lg:grid-cols-[220px_1fr]">
            <div className="relative mx-auto h-52 w-full max-w-56" aria-hidden="true">
              <ResponsiveContainer>
                <PieChart>
                  <Pie
                    data={entries}
                    dataKey="count"
                    nameKey="label"
                    innerRadius={64}
                    outerRadius={92}
                    paddingAngle={2}
                    stroke="hsl(var(--bg-elevated))"
                    strokeWidth={3}
                  >
                    {entries.map((entry, index) => (
                      <Cell key={entry.status} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-2xl font-bold tabular-nums tracking-tight text-fg-primary">{total.toLocaleString()}</span>
                <span className="mt-1 text-xs text-fg-tertiary">Tweet 总数</span>
              </div>
            </div>
            <div className="flex flex-col gap-3">
              {entries.map((entry, index) => (
                <div key={entry.status} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1.5">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="size-2.5 shrink-0 rounded-sm" style={{ background: CHART_COLORS[index % CHART_COLORS.length] }} />
                    <span className="truncate text-sm font-medium text-fg-primary">{entry.label}</span>
                  </div>
                  <span className="text-sm font-semibold tabular-nums text-fg-primary">{entry.count.toLocaleString()}</span>
                  <div className="col-span-2 h-1.5 overflow-hidden rounded-full bg-bg-muted">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${total ? Math.max((entry.count / total) * 100, 2) : 0}%`,
                        background: CHART_COLORS[index % CHART_COLORS.length],
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
