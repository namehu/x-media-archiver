import { Area, AreaChart, Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { EmptyState } from "@/components/ui/empty-state";

const timelineConfig = {
  tweets: { label: "Tweet", color: "hsl(var(--brand))" },
  media: { label: "媒体", color: "hsl(var(--accent))" },
} satisfies ChartConfig;

const importedTimelineConfig = {
  tweets: { label: "入库 Tweet", color: "hsl(var(--brand))" },
} satisfies ChartConfig;

export function PublishedTimelineChart({ rows }: { rows: Array<{ month: string; count: number; media_count: number }> }) {
  if (!rows.length) {
    return <EmptyState title="暂无发布时间趋势" description="只有带 published_at 的 Tweet 才会进入这张图。" />;
  }
  const data = rows.map((row) => ({
    month: formatMonth(row.month),
    tweets: row.count,
    media: row.media_count,
  }));

  return (
    <ChartContainer config={timelineConfig} className="aspect-auto h-72 w-full">
      <AreaChart accessibilityLayer data={data} margin={{ left: -12, right: 8, top: 8 }}>
        <defs>
          <linearGradient id="insights-tweet-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="5%" stopColor="var(--color-tweets)" stopOpacity={0.28} />
            <stop offset="95%" stopColor="var(--color-tweets)" stopOpacity={0.02} />
          </linearGradient>
          <linearGradient id="insights-media-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="5%" stopColor="var(--color-media)" stopOpacity={0.2} />
            <stop offset="95%" stopColor="var(--color-media)" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="month" tickLine={false} axisLine={false} minTickGap={28} />
        <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={36} />
        <ChartTooltip content={<ChartTooltipContent />} />
        <Area dataKey="tweets" type="monotone" fill="url(#insights-tweet-fill)" stroke="var(--color-tweets)" strokeWidth={2} />
        <Area dataKey="media" type="monotone" fill="url(#insights-media-fill)" stroke="var(--color-media)" strokeWidth={2} />
        <ChartLegend content={<ChartLegendContent />} />
      </AreaChart>
    </ChartContainer>
  );
}

export function ImportedTimelineChart({ rows }: { rows: Array<{ month: string; count: number }> }) {
  if (!rows.length) {
    return <EmptyState title="暂无入库时间趋势" description="Tweet 产生 imported_at 后会进入这张图。" />;
  }
  const data = rows.map((row) => ({ month: formatMonth(row.month), tweets: row.count }));

  return (
    <ChartContainer config={importedTimelineConfig} className="aspect-auto h-72 w-full">
      <BarChart accessibilityLayer data={data} margin={{ left: -12, right: 8, top: 8 }}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="month" tickLine={false} axisLine={false} minTickGap={28} />
        <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={36} />
        <ChartTooltip content={<ChartTooltipContent />} />
        <Bar dataKey="tweets" fill="var(--color-tweets)" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ChartContainer>
  );
}

function formatMonth(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", timeZone: "UTC" }).format(date);
}
