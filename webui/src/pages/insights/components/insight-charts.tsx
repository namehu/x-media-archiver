import { Area, AreaChart, Bar, BarChart, CartesianGrid, Pie, PieChart, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "../../../components/ui/chart";
import { EmptyState } from "../../../components/ui/empty-state";

const timelineConfig = {
  tweets: { label: "Tweet", color: "hsl(var(--brand))" },
  media: { label: "媒体", color: "hsl(var(--accent))" },
} satisfies ChartConfig;

const mediaTypeConfig = {
  photo: { label: "图片", color: "hsl(var(--brand))" },
  video: { label: "视频", color: "hsl(var(--accent))" },
  unknown: { label: "未知", color: "hsl(var(--fg-tertiary))" },
} satisfies ChartConfig;

const importedTimelineConfig = {
  tweets: { label: "入库 Tweet", color: "hsl(var(--success))" },
} satisfies ChartConfig;

const mediaTypeColors: Record<string, string> = {
  photo: "hsl(var(--brand))",
  video: "hsl(var(--accent))",
  unknown: "hsl(var(--fg-tertiary))",
};

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
    <ChartContainer config={timelineConfig} className="h-72 w-full aspect-auto">
      <AreaChart accessibilityLayer data={data} margin={{ left: -12, right: 8, top: 8 }}>
        <defs>
          <linearGradient id="insights-tweet-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="5%" stopColor="var(--color-tweets)" stopOpacity={0.35} />
            <stop offset="95%" stopColor="var(--color-tweets)" stopOpacity={0.04} />
          </linearGradient>
          <linearGradient id="insights-media-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="5%" stopColor="var(--color-media)" stopOpacity={0.28} />
            <stop offset="95%" stopColor="var(--color-media)" stopOpacity={0.03} />
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

export function MediaTypeChart({ rows }: { rows: Array<{ key: string; count: number }> }) {
  if (!rows.length) {
    return <EmptyState title="暂无媒体类型" description="媒体资产入库后会在这里按图片、视频与未知类型汇总。" />;
  }
  const data = rows.map((row) => ({
    key: row.key,
    label: mediaTypeLabel(row.key),
    count: row.count,
    fill: mediaTypeColors[row.key] ?? mediaTypeColors.unknown,
  }));

  return (
    <ChartContainer config={mediaTypeConfig} className="h-64 w-full aspect-auto">
      <PieChart accessibilityLayer>
        <ChartTooltip content={<ChartTooltipContent nameKey="key" />} />
        <Pie data={data} dataKey="count" nameKey="key" innerRadius={54} outerRadius={84} paddingAngle={3} />
        <ChartLegend content={<ChartLegendContent nameKey="key" />} />
      </PieChart>
    </ChartContainer>
  );
}

export function ImportedTimelineChart({ rows }: { rows: Array<{ month: string; count: number }> }) {
  if (!rows.length) {
    return <EmptyState title="暂无入库时间趋势" description="Tweet 产生 imported_at 后会进入这张图。" />;
  }
  const data = rows.map((row) => ({ month: formatMonth(row.month), tweets: row.count }));

  return (
    <ChartContainer config={importedTimelineConfig} className="h-64 w-full aspect-auto">
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

function mediaTypeLabel(value: string) {
  if (value === "photo") return "图片";
  if (value === "video") return "视频";
  return "未知";
}
