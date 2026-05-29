import { Bar, BarChart, Cell, Pie, PieChart, ResponsiveContainer, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui-next/card";

export type StatusChartEntry = {
  status: string;
  label: string;
  count: number;
};

export type ActivityEntry = {
  label: string;
  archived: number;
  failed: number;
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
  title,
  description,
  emptyLabel,
  entries,
}: {
  title: string;
  description: string;
  emptyLabel: string;
  entries: StatusChartEntry[];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        {entries.length === 0 ? (
          <p className="text-sm text-fg-secondary">{emptyLabel}</p>
        ) : (
          <div className="grid gap-4 md:grid-cols-[160px_1fr]">
            <div className="h-40">
              <ResponsiveContainer>
                <PieChart>
                  <Pie data={entries} dataKey="count" nameKey="label" innerRadius={46} outerRadius={70} paddingAngle={3}>
                    {entries.map((entry, index) => (
                      <Cell key={entry.status} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="space-y-2">
              {entries.map((entry, index) => (
                <div key={entry.status} className="flex items-center justify-between gap-3 rounded-md border border-border-subtle bg-bg-surface px-3 py-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="h-2 w-2 rounded-full" style={{ background: CHART_COLORS[index % CHART_COLORS.length] }} />
                    <span className="truncate text-sm font-medium text-fg-primary">{entry.label}</span>
                  </div>
                  <span className="text-sm font-semibold tabular-nums text-fg-primary">{entry.count}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function ActivityCard({ title, description, activity }: { title: string; description: string; activity: ActivityEntry[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="h-56">
          <ResponsiveContainer>
            <BarChart data={activity}>
              <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: "hsl(var(--fg-tertiary))", fontSize: 11 }} />
              <YAxis hide />
              <Bar dataKey="archived" fill="hsl(var(--brand))" radius={[6, 6, 0, 0]} />
              <Bar dataKey="failed" fill="hsl(var(--danger))" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
