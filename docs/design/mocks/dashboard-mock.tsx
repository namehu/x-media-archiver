/**
 * Dashboard 页面高保真 mock — Phase 4 视觉锚点
 *
 * 视觉立场: 白蓝清爽风 (Pixiv-like)
 * - 白底为主,Pixiv 蓝 (#0096FA) 单一主色,缩略图与数据为视觉主角
 * - 扁平 + 必要 elevation,高密度但靠字号层次呼吸
 * - 数字一律 tabular-nums,Hero 数字 36px bold,StatCard 数字 28px bold
 * - 微交互: card hover 升 elevation,status running 态 animate-breathe
 *
 * 信息架构 (上→下):
 *   1. Hero 区 (大数字 + 24h sparkline + LiveIndicator + SSE 事件流)
 *   2. 4 张 StatCard (进行中 / 失败队列 / 重复待处理 / 24h 新增)
 *   3. 双栏 (Tweet 状态分布 donut + 24h 归档活动堆叠柱状)
 *   4. Tabs (最近导出 / 最近失败)
 *   5. Worker 健康卡 (双 worker StatusDot + 心跳)
 *
 * 落地时:
 *   - StatCard / Sparkline / StatusDot / LiveIndicator / DonutChart / StackedBar
 *     抽到 webui/src/components/ui/ 下作为独立组件
 *   - 数据通过 useQuery + useEventStream 接 /api/v1/library/summary、/health/detail、/events
 */

import { useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  CheckCircle2,
  Copy,
  Database,
  Download,
  ExternalLink,
  FileX2,
  Files,
  Layers,
  RefreshCw,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import {
  Bar,
  BarChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";

// ===========================================================================
// Mock data (实施时替换为 API 数据)
// ===========================================================================

const HERO_TOTAL = 12438;
const HERO_DELTA_24H = 312;
const HERO_SPARKLINE = [
  118, 142, 138, 156, 172, 168, 184, 196, 188, 202, 218, 224,
  232, 248, 256, 244, 268, 282, 296, 312, 308, 324, 318, 332,
];

const STAT_CARDS = [
  {
    key: "running",
    label: "进行中",
    value: 23,
    delta: "+12%",
    deltaTone: "neutral" as const,
    icon: Activity,
    sparkline: [3, 5, 4, 7, 9, 12, 14, 18, 21, 19, 23],
    accent: "brand" as const,
  },
  {
    key: "failed",
    label: "失败队列",
    value: 7,
    delta: "-3",
    deltaTone: "down" as const,
    icon: AlertTriangle,
    sparkline: [12, 14, 11, 9, 10, 8, 7, 9, 8, 7, 7],
    accent: "danger" as const,
  },
  {
    key: "duplicates",
    label: "重复待处理",
    value: 14,
    delta: "+2",
    deltaTone: "up" as const,
    icon: Layers,
    sparkline: [8, 10, 9, 11, 13, 12, 14, 13, 14, 13, 14],
    accent: "warning" as const,
  },
  {
    key: "new24h",
    label: "24h 新增",
    value: 312,
    delta: "+18%",
    deltaTone: "up" as const,
    icon: TrendingUp,
    sparkline: [120, 168, 196, 218, 248, 268, 282, 296, 308, 318, 312],
    accent: "success" as const,
  },
];

const STATUS_DISTRIBUTION = [
  { name: "verified", value: 9842, color: "hsl(152 60% 42%)" },
  { name: "pending", value: 184, color: "hsl(38 92% 50%)" },
  { name: "downloading", value: 23, color: "hsl(206 100% 49%)" },
  { name: "failed_retryable", value: 56, color: "hsl(354 76% 52%)" },
  { name: "missing", value: 12, color: "hsl(354 76% 52% / 0.55)" },
  { name: "duplicate", value: 14, color: "hsl(196 88% 56%)" },
];

const STATUS_LABEL: Record<string, string> = {
  verified: "已验证",
  pending: "待下载",
  downloading: "下载中",
  failed_retryable: "失败可重试",
  missing: "文件丢失",
  duplicate: "重复",
};

const ACTIVITY_24H = [
  { hour: "00", success: 18, failed: 1, running: 0 },
  { hour: "02", success: 12, failed: 0, running: 0 },
  { hour: "04", success: 8, failed: 0, running: 0 },
  { hour: "06", success: 14, failed: 1, running: 0 },
  { hour: "08", success: 24, failed: 2, running: 1 },
  { hour: "10", success: 32, failed: 3, running: 2 },
  { hour: "12", success: 38, failed: 1, running: 3 },
  { hour: "14", success: 42, failed: 2, running: 4 },
  { hour: "16", success: 36, failed: 1, running: 5 },
  { hour: "18", success: 28, failed: 0, running: 4 },
  { hour: "20", success: 22, failed: 1, running: 2 },
  { hour: "22", success: 16, failed: 1, running: 2 },
];

const LIVE_EVENTS = [
  { id: 1, time: "13:42:18", topic: "queue", text: "归档完成 · @sora_design 的 4 张图片", tone: "success" as const },
  { id: 2, time: "13:41:52", topic: "sources", text: "扫描发现 7 条新 tweet · profile/h_kabuto", tone: "info" as const },
  { id: 3, time: "13:40:09", topic: "queue", text: "重试成功 · tweet 1789234567890", tone: "success" as const },
];

const RECENT_EXPORTS = [
  { name: "media-2026-05-28.csv", path: "/exports/media-2026-05-28.csv", size: "4.2 MB", time: "13:20" },
  { name: "failures-2026-05-27.csv", path: "/exports/failures-2026-05-27.csv", size: "812 KB", time: "昨天 18:45" },
  { name: "duplicates-2026-05-26.csv", path: "/exports/duplicates-2026-05-26.csv", size: "1.6 MB", time: "2 天前" },
];

const RECENT_FAILURES = [
  { id: "1789...4567", reason: "HTTP 429 Rate limit", retryCount: 2, time: "13:38" },
  { id: "1789...3211", reason: "MediaUnavailable", retryCount: 5, time: "13:14" },
  { id: "1789...8809", reason: "ChecksumMismatch", retryCount: 1, time: "12:52" },
];

// ===========================================================================
// 子组件 (落地时各自迁移到 ui/)
// ===========================================================================

/** ui/sparkline.tsx — SVG path 折线,无依赖 */
function Sparkline({
  data,
  color = "hsl(206 100% 49%)",
  height = 36,
  fillOpacity = 0.12,
}: {
  data: number[];
  color?: string;
  height?: number;
  fillOpacity?: number;
}) {
  const w = 100;
  const h = height;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const step = w / (data.length - 1);
  const points = data
    .map((v, i) => `${i * step},${h - ((v - min) / range) * (h - 4) - 2}`)
    .join(" ");
  const area = `M0,${h} L${points} L${w},${h} Z`;
  const line = `M${points.replace(/ /g, " L")}`;

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="block w-full overflow-visible" preserveAspectRatio="none">
      <path d={area} fill={color} fillOpacity={fillOpacity} />
      <path d={line} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** ui/status-dot.tsx — 状态点,running 态呼吸 */
function StatusDot({
  status,
  className = "",
}: {
  status: "running" | "success" | "warning" | "danger" | "idle";
  className?: string;
}) {
  const tone =
    status === "success"
      ? "bg-[hsl(152_60%_42%)]"
      : status === "warning"
      ? "bg-[hsl(38_92%_50%)]"
      : status === "danger"
      ? "bg-[hsl(354_76%_52%)]"
      : status === "running"
      ? "bg-[hsl(206_100%_49%)]"
      : "bg-[hsl(215_12%_56%)]";
  return (
    <span
      aria-label={status}
      className={`relative inline-flex h-2 w-2 rounded-full ${tone} ${className}`}
    >
      {status === "running" && (
        <span className={`absolute inset-0 rounded-full ${tone} opacity-60 animate-ping`} />
      )}
    </span>
  );
}

/** ui/live-indicator.tsx — SSE 连接状态 */
function LiveIndicator({ state }: { state: "connecting" | "open" | "reconnecting" | "closed" }) {
  const cfg = {
    connecting: { dot: "warning" as const, text: "连接中…", tone: "text-[hsl(38_92%_50%)]" },
    open: { dot: "running" as const, text: "已连接", tone: "text-[hsl(152_60%_42%)]" },
    reconnecting: { dot: "warning" as const, text: "重连中", tone: "text-[hsl(38_92%_50%)]" },
    closed: { dot: "danger" as const, text: "已断开", tone: "text-[hsl(354_76%_52%)]" },
  }[state];
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${cfg.tone}`}>
      <StatusDot status={cfg.dot} />
      {cfg.text}
    </span>
  );
}

/** ui/stat-card.tsx — 统计卡 */
function StatCard({
  label,
  value,
  delta,
  deltaTone,
  icon: Icon,
  sparkline,
  accent,
}: (typeof STAT_CARDS)[number]) {
  const accentMap = {
    brand: { color: "hsl(206 100% 49%)", iconBg: "bg-[hsl(206_100%_49%/0.08)]", iconText: "text-[hsl(206_100%_49%)]" },
    success: { color: "hsl(152 60% 42%)", iconBg: "bg-[hsl(152_60%_42%/0.10)]", iconText: "text-[hsl(152_60%_42%)]" },
    warning: { color: "hsl(38 92% 50%)", iconBg: "bg-[hsl(38_92%_50%/0.10)]", iconText: "text-[hsl(38_92%_50%)]" },
    danger: { color: "hsl(354 76% 52%)", iconBg: "bg-[hsl(354_76%_52%/0.10)]", iconText: "text-[hsl(354_76%_52%)]" },
  }[accent];

  const deltaIcon =
    deltaTone === "up" ? (
      <ArrowUpRight className="h-3 w-3" strokeWidth={2.5} />
    ) : deltaTone === "down" ? (
      <ArrowDownRight className="h-3 w-3" strokeWidth={2.5} />
    ) : null;
  const deltaColor =
    deltaTone === "up"
      ? "text-[hsl(152_60%_42%)]"
      : deltaTone === "down"
      ? "text-[hsl(354_76%_52%)]"
      : "text-[hsl(215_16%_38%)]";

  return (
    <div className="group relative overflow-hidden rounded-lg border border-[hsl(214_22%_92%)] bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-all duration-200 ease-out hover:-translate-y-0.5 hover:border-[hsl(214_16%_84%)] hover:shadow-[0_4px_12px_rgba(15,23,42,0.06)] dark:border-[hsl(215_18%_22%)] dark:bg-[hsl(215_24%_12%)] dark:hover:border-[hsl(215_16%_30%)]">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="text-xs font-medium tracking-wide text-[hsl(215_16%_38%)] dark:text-[hsl(215_12%_70%)]">
            {label}
          </span>
          <span className="text-[28px] font-bold leading-[1.1] tabular-nums text-[hsl(215_28%_17%)] dark:text-[hsl(210_20%_96%)]">
            {value.toLocaleString()}
          </span>
          <span className={`inline-flex items-center gap-0.5 text-xs font-medium ${deltaColor}`}>
            {deltaIcon}
            <span className="tabular-nums">{delta}</span>
            <span className="text-[hsl(215_12%_56%)]"> · 24h</span>
          </span>
        </div>
        <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md ${accentMap.iconBg} ${accentMap.iconText}`}>
          <Icon className="h-4 w-4" strokeWidth={2} />
        </div>
      </div>
      <div className="mt-3 h-9">
        <Sparkline data={sparkline} color={accentMap.color} height={36} />
      </div>
    </div>
  );
}

/** Hero 区:大数字 + 24h sparkline + Live + 事件流 */
function DashboardHero() {
  return (
    <section className="grid gap-4 rounded-xl border border-[hsl(214_22%_92%)] bg-gradient-to-br from-white via-white to-[hsl(206_100%_49%/0.02)] p-6 shadow-[0_1px_2px_rgba(15,23,42,0.04)] lg:grid-cols-[1.4fr_1fr] dark:border-[hsl(215_18%_22%)] dark:from-[hsl(215_24%_12%)] dark:via-[hsl(215_24%_12%)] dark:to-[hsl(206_92%_60%/0.06)]">
      {/* 左:Hero 数字 */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2 text-xs font-medium tracking-[0.08em] text-[hsl(215_16%_38%)] uppercase dark:text-[hsl(215_12%_70%)]">
          <Files className="h-3.5 w-3.5" />
          <span>媒体总数</span>
          <span className="ml-auto text-[hsl(215_12%_56%)] normal-case tracking-normal">
            最后同步 13:42
          </span>
        </div>
        <div className="flex items-end gap-3">
          <span className="text-[44px] font-bold leading-[1] tabular-nums text-[hsl(215_28%_17%)] dark:text-[hsl(210_20%_96%)]">
            {HERO_TOTAL.toLocaleString()}
          </span>
          <span className="mb-1 inline-flex items-center gap-1 rounded-md bg-[hsl(152_60%_42%/0.10)] px-1.5 py-0.5 text-xs font-semibold text-[hsl(152_60%_42%)]">
            <ArrowUpRight className="h-3 w-3" strokeWidth={2.5} />
            <span className="tabular-nums">+{HERO_DELTA_24H}</span>
            <span className="font-medium opacity-80">/ 24h</span>
          </span>
        </div>
        <div className="h-12">
          <Sparkline data={HERO_SPARKLINE} color="hsl(206 100% 49%)" height={48} fillOpacity={0.16} />
        </div>
        <div className="mt-1 flex items-center gap-1.5 text-xs text-[hsl(215_12%_56%)]">
          <span>过去 24 小时趋势</span>
          <span aria-hidden>·</span>
          <span>归档目录 ~/Movies/x-archive</span>
        </div>
      </div>

      {/* 右:Live + 事件流 */}
      <div className="flex flex-col gap-2 rounded-lg border border-[hsl(214_22%_92%)] bg-white/60 p-3 backdrop-blur-sm dark:border-[hsl(215_18%_22%)] dark:bg-[hsl(215_22%_16%)]/40">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="h-3.5 w-3.5 text-[hsl(206_100%_49%)]" />
            <span className="text-xs font-semibold tracking-wide text-[hsl(215_28%_17%)] uppercase dark:text-[hsl(210_20%_96%)]">
              实时事件
            </span>
          </div>
          <LiveIndicator state="open" />
        </div>
        <div className="space-y-1">
          {LIVE_EVENTS.map((ev) => (
            <div
              key={ev.id}
              className="group flex items-start gap-2 rounded-md px-2 py-1.5 transition-colors duration-fast hover:bg-[hsl(214_32%_96%)] dark:hover:bg-[hsl(215_20%_18%)]"
            >
              <StatusDot status={ev.tone === "success" ? "success" : "running"} className="mt-1.5" />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-1.5">
                  <span className="text-xs font-medium tabular-nums text-[hsl(215_12%_56%)]">{ev.time}</span>
                  <span className="rounded bg-[hsl(214_32%_96%)] px-1 py-px text-[10px] font-medium text-[hsl(215_16%_38%)] dark:bg-[hsl(215_20%_18%)] dark:text-[hsl(215_12%_70%)]">
                    {ev.topic}
                  </span>
                </div>
                <div className="truncate text-sm text-[hsl(215_28%_17%)] dark:text-[hsl(210_20%_96%)]">
                  {ev.text}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/** 状态分布 donut chart */
function StatusDistributionCard() {
  const total = STATUS_DISTRIBUTION.reduce((s, d) => s + d.value, 0);
  return (
    <div className="rounded-lg border border-[hsl(214_22%_92%)] bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:border-[hsl(215_18%_22%)] dark:bg-[hsl(215_24%_12%)]">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-base font-semibold text-[hsl(215_28%_17%)] dark:text-[hsl(210_20%_96%)]">
          Tweet 状态分布
        </h3>
        <span className="text-xs text-[hsl(215_12%_56%)] tabular-nums">
          总计 {total.toLocaleString()}
        </span>
      </div>
      <div className="grid gap-4 md:grid-cols-[180px_1fr]">
        <div className="relative h-[180px]">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={STATUS_DISTRIBUTION}
                cx="50%"
                cy="50%"
                innerRadius={56}
                outerRadius={82}
                paddingAngle={2}
                dataKey="value"
                stroke="none"
              >
                {STATUS_DISTRIBUTION.map((entry, i) => (
                  <Cell key={i} fill={entry.color} />
                ))}
              </Pie>
              <RechartsTooltip
                contentStyle={{
                  borderRadius: 6,
                  border: "1px solid hsl(214 16% 84%)",
                  fontSize: 12,
                  padding: "6px 10px",
                  background: "white",
                  boxShadow: "0 4px 12px rgba(15,23,42,0.06)",
                }}
                labelStyle={{ display: "none" }}
                formatter={(v: number, _n, item) => [
                  v.toLocaleString(),
                  STATUS_LABEL[(item.payload as { name: string }).name] ?? "—",
                ]}
              />
            </PieChart>
          </ResponsiveContainer>
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-xs font-medium uppercase tracking-wider text-[hsl(215_12%_56%)]">已验证</span>
            <span className="text-2xl font-bold tabular-nums text-[hsl(152_60%_42%)]">
              {Math.round((STATUS_DISTRIBUTION[0].value / total) * 100)}%
            </span>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-1.5 self-center">
          {STATUS_DISTRIBUTION.map((d) => (
            <div key={d.name} className="flex items-center justify-between gap-3 text-sm">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: d.color }} />
                <span className="text-[hsl(215_28%_17%)] dark:text-[hsl(210_20%_96%)]">
                  {STATUS_LABEL[d.name] ?? d.name}
                </span>
              </div>
              <span className="font-semibold tabular-nums text-[hsl(215_28%_17%)] dark:text-[hsl(210_20%_96%)]">
                {d.value.toLocaleString()}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** 24h 归档活动堆叠柱状 */
function ActivityChartCard() {
  return (
    <div className="rounded-lg border border-[hsl(214_22%_92%)] bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:border-[hsl(215_18%_22%)] dark:bg-[hsl(215_24%_12%)]">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-base font-semibold text-[hsl(215_28%_17%)] dark:text-[hsl(210_20%_96%)]">
          24h 归档活动
        </h3>
        <div className="flex items-center gap-3 text-xs">
          <LegendDot color="hsl(152 60% 42%)" label="成功" />
          <LegendDot color="hsl(38 92% 50%)" label="进行中" />
          <LegendDot color="hsl(354 76% 52%)" label="失败" />
        </div>
      </div>
      <div className="h-[200px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={ACTIVITY_24H} margin={{ top: 4, right: 0, left: -16, bottom: 0 }} barCategoryGap="22%">
            <XAxis
              dataKey="hour"
              axisLine={false}
              tickLine={false}
              tick={{ fill: "hsl(215 12% 56%)", fontSize: 11 }}
              dy={6}
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              tick={{ fill: "hsl(215 12% 56%)", fontSize: 11 }}
              width={32}
            />
            <RechartsTooltip
              cursor={{ fill: "hsl(214 32% 96%)" }}
              contentStyle={{
                borderRadius: 6,
                border: "1px solid hsl(214 16% 84%)",
                fontSize: 12,
                padding: "6px 10px",
                background: "white",
                boxShadow: "0 4px 12px rgba(15,23,42,0.06)",
              }}
              labelFormatter={(h) => `${h}:00`}
            />
            <Bar dataKey="success" stackId="a" fill="hsl(152 60% 42%)" radius={[0, 0, 0, 0]} />
            <Bar dataKey="running" stackId="a" fill="hsl(38 92% 50%)" radius={[0, 0, 0, 0]} />
            <Bar dataKey="failed" stackId="a" fill="hsl(354 76% 52%)" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[hsl(215_16%_38%)] dark:text-[hsl(215_12%_70%)]">
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
      {label}
    </span>
  );
}

/** Tabs: 最近导出 / 最近失败 */
function RecentTabsCard() {
  const [tab, setTab] = useState<"exports" | "failures">("exports");
  return (
    <div className="rounded-lg border border-[hsl(214_22%_92%)] bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:border-[hsl(215_18%_22%)] dark:bg-[hsl(215_24%_12%)]">
      <div className="flex items-center justify-between border-b border-[hsl(214_22%_92%)] px-5 dark:border-[hsl(215_18%_22%)]">
        <div className="flex">
          <TabButton active={tab === "exports"} onClick={() => setTab("exports")}>
            <Download className="h-3.5 w-3.5" />
            最近导出
          </TabButton>
          <TabButton active={tab === "failures"} onClick={() => setTab("failures")}>
            <FileX2 className="h-3.5 w-3.5" />
            最近失败
          </TabButton>
        </div>
        <button className="my-2 inline-flex items-center gap-1 rounded-md border border-[hsl(214_22%_92%)] bg-white px-2 py-1 text-xs font-medium text-[hsl(215_16%_38%)] transition-all duration-fast hover:border-[hsl(214_16%_84%)] hover:text-[hsl(215_28%_17%)] dark:border-[hsl(215_18%_22%)] dark:bg-[hsl(215_22%_16%)] dark:text-[hsl(215_12%_70%)] dark:hover:text-[hsl(210_20%_96%)]">
          <RefreshCw className="h-3 w-3" />
          刷新
        </button>
      </div>
      <div className="divide-y divide-[hsl(214_22%_92%)] dark:divide-[hsl(215_18%_22%)]">
        {tab === "exports"
          ? RECENT_EXPORTS.map((f) => (
              <div
                key={f.path}
                className="group flex items-center gap-3 px-5 py-3 transition-colors duration-fast hover:bg-[hsl(214_32%_96%)] dark:hover:bg-[hsl(215_20%_18%)]"
              >
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[hsl(206_100%_49%/0.08)] text-[hsl(206_100%_49%)]">
                  <Download className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-[hsl(215_28%_17%)] dark:text-[hsl(210_20%_96%)]">
                    {f.name}
                  </div>
                  <div className="text-xs text-[hsl(215_12%_56%)] tabular-nums">
                    {f.size} · {f.time}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity duration-fast group-hover:opacity-100">
                  <IconBtn label="复制路径"><Copy className="h-3.5 w-3.5" /></IconBtn>
                  <IconBtn label="打开"><ExternalLink className="h-3.5 w-3.5" /></IconBtn>
                </div>
              </div>
            ))
          : RECENT_FAILURES.map((f) => (
              <div
                key={f.id}
                className="group flex items-center gap-3 px-5 py-3 transition-colors duration-fast hover:bg-[hsl(214_32%_96%)] dark:hover:bg-[hsl(215_20%_18%)]"
              >
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[hsl(354_76%_52%/0.10)] text-[hsl(354_76%_52%)]">
                  <AlertTriangle className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <code className="truncate font-mono text-xs text-[hsl(215_28%_17%)] dark:text-[hsl(210_20%_96%)]">
                      {f.id}
                    </code>
                    <span className="rounded bg-[hsl(354_76%_52%/0.10)] px-1.5 py-px text-[10px] font-medium text-[hsl(354_76%_52%)]">
                      重试 ×{f.retryCount}
                    </span>
                  </div>
                  <div className="text-xs text-[hsl(215_16%_38%)] dark:text-[hsl(215_12%_70%)]">
                    {f.reason} · {f.time}
                  </div>
                </div>
                <button className="shrink-0 rounded-md border border-[hsl(214_22%_92%)] bg-white px-2 py-1 text-xs font-medium text-[hsl(215_16%_38%)] transition-all duration-fast hover:border-[hsl(206_100%_49%)] hover:text-[hsl(206_100%_49%)] dark:border-[hsl(215_18%_22%)] dark:bg-[hsl(215_22%_16%)] dark:text-[hsl(215_12%_70%)]">
                  重试
                </button>
              </div>
            ))}
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`relative inline-flex items-center gap-1.5 px-4 py-3 text-sm font-medium transition-colors duration-fast ${
        active
          ? "text-[hsl(206_100%_49%)]"
          : "text-[hsl(215_16%_38%)] hover:text-[hsl(215_28%_17%)] dark:text-[hsl(215_12%_70%)] dark:hover:text-[hsl(210_20%_96%)]"
      }`}
    >
      {children}
      {active && (
        <span className="absolute bottom-0 left-3 right-3 h-[2px] rounded-full bg-[hsl(206_100%_49%)]" />
      )}
    </button>
  );
}

function IconBtn({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <button
      title={label}
      aria-label={label}
      className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[hsl(215_12%_56%)] transition-all duration-fast hover:bg-[hsl(214_32%_96%)] hover:text-[hsl(215_28%_17%)] dark:hover:bg-[hsl(215_20%_18%)] dark:hover:text-[hsl(210_20%_96%)]"
    >
      {children}
    </button>
  );
}

/** Worker 健康卡 */
function WorkerHealthCard() {
  const workers = [
    { name: "archive-queue-worker", status: "running" as const, lastTick: "13:42:31", note: "处理 23 个任务 · 写锁 idle" },
    { name: "source-scan-worker", status: "running" as const, lastTick: "13:42:28", note: "扫描 4 个源 · 1 个 waiting_downloads" },
  ];
  return (
    <div className="rounded-lg border border-[hsl(214_22%_92%)] bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:border-[hsl(215_18%_22%)] dark:bg-[hsl(215_24%_12%)]">
      <div className="mb-3 flex items-center gap-2">
        <Database className="h-4 w-4 text-[hsl(215_16%_38%)] dark:text-[hsl(215_12%_70%)]" />
        <h3 className="text-base font-semibold text-[hsl(215_28%_17%)] dark:text-[hsl(210_20%_96%)]">
          Worker 健康
        </h3>
        <span className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-[hsl(152_60%_42%)]">
          <CheckCircle2 className="h-3 w-3" />
          全部正常
        </span>
      </div>
      <div className="grid gap-2 md:grid-cols-2">
        {workers.map((w) => (
          <div
            key={w.name}
            className="flex items-center gap-3 rounded-md border border-[hsl(214_22%_92%)] bg-[hsl(210_20%_98%)] px-3 py-2.5 dark:border-[hsl(215_18%_22%)] dark:bg-[hsl(215_22%_16%)]"
          >
            <StatusDot status={w.status} />
            <div className="min-w-0 flex-1">
              <div className="truncate font-mono text-xs font-medium text-[hsl(215_28%_17%)] dark:text-[hsl(210_20%_96%)]">
                {w.name}
              </div>
              <div className="truncate text-xs text-[hsl(215_12%_56%)]">
                {w.note}
              </div>
            </div>
            <span className="shrink-0 font-mono text-[10px] tabular-nums text-[hsl(215_12%_56%)]">
              {w.lastTick}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ===========================================================================
// 页面
// ===========================================================================

export default function DashboardMock() {
  return (
    <div className="min-h-screen bg-[hsl(210_20%_98%)] px-6 py-6 dark:bg-[hsl(215_28%_9%)]">
      <div className="mx-auto flex max-w-[1280px] flex-col gap-5">
        {/* 页头 */}
        <header className="flex items-end justify-between">
          <div>
            <h1 className="text-2xl font-bold leading-tight text-[hsl(215_28%_17%)] dark:text-[hsl(210_20%_96%)]">
              控制台总览
            </h1>
            <p className="mt-1 text-sm text-[hsl(215_16%_38%)] dark:text-[hsl(215_12%_70%)]">
              x-media-archiver · 本地媒体归档系统实时状态
            </p>
          </div>
          <div className="hidden items-center gap-2 md:flex">
            <button className="inline-flex items-center gap-1.5 rounded-md border border-[hsl(214_22%_92%)] bg-white px-3 py-1.5 text-sm font-medium text-[hsl(215_16%_38%)] transition-all duration-fast hover:-translate-y-px hover:border-[hsl(214_16%_84%)] hover:shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:border-[hsl(215_18%_22%)] dark:bg-[hsl(215_24%_12%)] dark:text-[hsl(215_12%_70%)]">
              <RefreshCw className="h-3.5 w-3.5" />
              刷新
            </button>
            <button className="inline-flex items-center gap-1.5 rounded-md bg-[hsl(206_100%_49%)] px-3 py-1.5 text-sm font-semibold text-white shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-all duration-fast hover:-translate-y-px hover:bg-[hsl(206_100%_42%)] hover:shadow-[0_4px_12px_rgba(15,23,42,0.06)]">
              <Download className="h-3.5 w-3.5" />
              新建归档
            </button>
          </div>
        </header>

        <DashboardHero />

        {/* 4 张 StatCard */}
        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {STAT_CARDS.map((s) => (
            <StatCard key={s.key} {...s} />
          ))}
        </section>

        {/* 双图表 */}
        <section className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
          <StatusDistributionCard />
          <ActivityChartCard />
        </section>

        {/* Tabs + Worker */}
        <section className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
          <RecentTabsCard />
          <WorkerHealthCard />
        </section>
      </div>
    </div>
  );
}
