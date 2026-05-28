/**
 * Library 页面高保真 mock — Phase 4 视觉锚点
 *
 * 视觉立场: 白蓝清爽风 (Pixiv-like)
 * - 缩略图为视觉绝对主角,UI chrome 让位
 * - 高密度网格,4-6 列响应式 (Pixiv 即视感)
 * - hover 时 overlay 显示 metadata 与快捷操作,默认状态干净
 * - 状态徽章用色点 (StatusDot) 而非全色块,降低视觉噪音
 * - 选中态用 brand 描边 + brand-soft 弱底
 *
 * 信息架构:
 *   1. 顶部 sticky filter bar (chip 状态多选 + 日期 + 来源 + 类型 + 搜索)
 *   2. 视图切换 (Grid / Compact List) + 排序
 *   3. 网格 / 列表主体
 *   4. 底部浮动 batch dock (选中时弹出)
 *   5. 分页 + 跳转输入
 *
 * 落地时:
 *   - MediaThumbnail / FilterChip / Pagination / BatchDock 抽到 ui-next/
 *   - 数据通过 useQuery + SSE invalidate 接 /api/v1/library/media
 *   - 长列表用 react-virtuoso 做虚拟滚动
 */

import { useMemo, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Copy,
  Download,
  Eye,
  ExternalLink,
  Grid3x3,
  Image as ImageIcon,
  LayoutList,
  ListFilter,
  Play,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Trash2,
  X,
} from "lucide-react";

// ===========================================================================
// Mock data
// ===========================================================================

type MediaStatus = "verified" | "pending" | "failed" | "missing" | "corrupt" | "downloading";
type MediaType = "photo" | "video" | "gif";

type MediaItem = {
  id: string;
  tweetId: string;
  author: string;
  publishedAt: string;
  caption: string;
  mediaType: MediaType;
  mediaIndex: number;
  mediaTotal: number;
  status: MediaStatus;
  duration?: string; // 仅 video
  aspectRatio: "16/9" | "1/1" | "9/16" | "4/5";
  /** 占位图色调,模拟真实缩略图差异 */
  hue: number;
};

const MEDIA: MediaItem[] = [
  { id: "m1", tweetId: "1789234567890123456", author: "sora_design", publishedAt: "2026-05-28 13:42", caption: "新作:晨光中的 Tokyo Tower 速写", mediaType: "photo", mediaIndex: 1, mediaTotal: 4, status: "verified", aspectRatio: "1/1", hue: 206 },
  { id: "m2", tweetId: "1789234567890123457", author: "h_kabuto", publishedAt: "2026-05-28 13:21", caption: "30s 流体粒子测试,WebGL2", mediaType: "video", mediaIndex: 1, mediaTotal: 1, status: "verified", duration: "0:30", aspectRatio: "16/9", hue: 268 },
  { id: "m3", tweetId: "1789234567890123458", author: "linen_studio", publishedAt: "2026-05-28 12:58", caption: "夏日纸盘设计稿", mediaType: "photo", mediaIndex: 2, mediaTotal: 3, status: "pending", aspectRatio: "9/16", hue: 38 },
  { id: "m4", tweetId: "1789234567890123459", author: "moss_kana", publishedAt: "2026-05-28 12:31", caption: "苔藓微距 #moss", mediaType: "photo", mediaIndex: 1, mediaTotal: 1, status: "verified", aspectRatio: "4/5", hue: 152 },
  { id: "m5", tweetId: "1789234567890123460", author: "ink_pixel", publishedAt: "2026-05-28 11:48", caption: "GIF: 像素风落日循环 8s", mediaType: "gif", mediaIndex: 1, mediaTotal: 1, status: "verified", duration: "0:08", aspectRatio: "1/1", hue: 12 },
  { id: "m6", tweetId: "1789234567890123461", author: "kana_tone", publishedAt: "2026-05-28 11:12", caption: "Risograph 双色印刷测试", mediaType: "photo", mediaIndex: 1, mediaTotal: 6, status: "verified", aspectRatio: "1/1", hue: 320 },
  { id: "m7", tweetId: "1789234567890123462", author: "atelier_v", publishedAt: "2026-05-28 10:42", caption: "未命名作品 #wip", mediaType: "photo", mediaIndex: 3, mediaTotal: 4, status: "failed", aspectRatio: "9/16", hue: 354 },
  { id: "m8", tweetId: "1789234567890123463", author: "mochi_no", publishedAt: "2026-05-28 10:05", caption: "雨后的小巷,胶片感处理", mediaType: "photo", mediaIndex: 1, mediaTotal: 2, status: "verified", aspectRatio: "4/5", hue: 196 },
  { id: "m9", tweetId: "1789234567890123464", author: "h_kabuto", publishedAt: "2026-05-28 09:38", caption: "WebGPU 性能测试 60fps@4K", mediaType: "video", mediaIndex: 1, mediaTotal: 1, status: "downloading", duration: "1:24", aspectRatio: "16/9", hue: 280 },
  { id: "m10", tweetId: "1789234567890123465", author: "neko_atlas", publishedAt: "2026-05-28 09:02", caption: "京都地图绘制过程", mediaType: "photo", mediaIndex: 4, mediaTotal: 8, status: "verified", aspectRatio: "1/1", hue: 88 },
  { id: "m11", tweetId: "1789234567890123466", author: "petal_pp", publishedAt: "2026-05-28 08:24", caption: "花瓣排版练习", mediaType: "photo", mediaIndex: 1, mediaTotal: 1, status: "verified", aspectRatio: "9/16", hue: 340 },
  { id: "m12", tweetId: "1789234567890123467", author: "dust_machine", publishedAt: "2026-05-28 07:51", caption: "机械臂日记 ep.42", mediaType: "video", mediaIndex: 1, mediaTotal: 1, status: "missing", duration: "2:10", aspectRatio: "16/9", hue: 220 },
  { id: "m13", tweetId: "1789234567890123468", author: "sora_design", publishedAt: "2026-05-28 07:18", caption: "色卡更新", mediaType: "photo", mediaIndex: 2, mediaTotal: 5, status: "verified", aspectRatio: "1/1", hue: 168 },
  { id: "m14", tweetId: "1789234567890123469", author: "wabi_sabi", publishedAt: "2026-05-28 06:42", caption: "枯山水的几何", mediaType: "photo", mediaIndex: 1, mediaTotal: 1, status: "verified", aspectRatio: "4/5", hue: 28 },
  { id: "m15", tweetId: "1789234567890123470", author: "linen_studio", publishedAt: "2026-05-28 06:15", caption: "纸张纹理扫描", mediaType: "photo", mediaIndex: 1, mediaTotal: 12, status: "verified", aspectRatio: "1/1", hue: 42 },
  { id: "m16", tweetId: "1789234567890123471", author: "ink_pixel", publishedAt: "2026-05-28 05:48", caption: "Pixel art 动画帧 1/24", mediaType: "gif", mediaIndex: 1, mediaTotal: 1, status: "verified", duration: "0:04", aspectRatio: "1/1", hue: 0 },
];

const STATUS_CONFIG: Record<MediaStatus, { label: string; dot: string; bg: string; text: string; icon: typeof CheckCircle2 }> = {
  verified: { label: "已验证", dot: "bg-[hsl(152_60%_42%)]", bg: "bg-[hsl(152_60%_42%/0.10)]", text: "text-[hsl(152_60%_42%)]", icon: CheckCircle2 },
  pending: { label: "待下载", dot: "bg-[hsl(38_92%_50%)]", bg: "bg-[hsl(38_92%_50%/0.10)]", text: "text-[hsl(38_92%_50%)]", icon: Clock },
  downloading: { label: "下载中", dot: "bg-[hsl(206_100%_49%)]", bg: "bg-[hsl(206_100%_49%/0.10)]", text: "text-[hsl(206_100%_49%)]", icon: Download },
  failed: { label: "失败", dot: "bg-[hsl(354_76%_52%)]", bg: "bg-[hsl(354_76%_52%/0.10)]", text: "text-[hsl(354_76%_52%)]", icon: AlertCircle },
  missing: { label: "丢失", dot: "bg-[hsl(354_76%_52%/0.55)]", bg: "bg-[hsl(354_76%_52%/0.08)]", text: "text-[hsl(354_76%_52%/0.85)]", icon: AlertCircle },
  corrupt: { label: "损坏", dot: "bg-[hsl(354_76%_52%)]", bg: "bg-[hsl(354_76%_52%/0.10)]", text: "text-[hsl(354_76%_52%)]", icon: AlertCircle },
};

const FILTER_STATUSES: { key: MediaStatus | "all"; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "verified", label: "已验证" },
  { key: "pending", label: "待下载" },
  { key: "downloading", label: "下载中" },
  { key: "failed", label: "失败" },
  { key: "missing", label: "丢失" },
];

// ===========================================================================
// 子组件
// ===========================================================================

/** ui-next/media-thumbnail.tsx —— 统一缩略图,带 loading / hover overlay / 角标 */
function MediaThumbnail({
  item,
  selected,
  onSelect,
}: {
  item: MediaItem;
  selected: boolean;
  onSelect: () => void;
}) {
  const status = STATUS_CONFIG[item.status];
  const aspectClass =
    item.aspectRatio === "16/9"
      ? "aspect-video"
      : item.aspectRatio === "1/1"
      ? "aspect-square"
      : item.aspectRatio === "9/16"
      ? "aspect-[9/16]"
      : "aspect-[4/5]";

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onSelect()}
      className={`group relative overflow-hidden rounded-lg border bg-[hsl(214_32%_96%)] transition-all duration-200 ease-out focus:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(206_100%_49%/0.5)] focus-visible:ring-offset-2 ${
        selected
          ? "border-[hsl(206_100%_49%)] shadow-[0_0_0_3px_hsl(206_100%_49%/0.12)]"
          : "border-[hsl(214_22%_92%)] hover:-translate-y-0.5 hover:border-[hsl(214_16%_84%)] hover:shadow-[0_4px_12px_rgba(15,23,42,0.06)] dark:border-[hsl(215_18%_22%)] dark:hover:border-[hsl(215_16%_30%)]"
      }`}
    >
      {/* 占位缩略图 — 用渐变 + 噪点模拟真实图片差异 */}
      <div
        className={`relative ${aspectClass} w-full overflow-hidden`}
        style={{
          background: `linear-gradient(135deg, hsl(${item.hue} 50% 65%) 0%, hsl(${(item.hue + 60) % 360} 55% 50%) 100%)`,
        }}
      >
        {/* 噪点层(模拟图片质感) */}
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.18] mix-blend-overlay"
          style={{
            backgroundImage:
              "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")",
          }}
        />
        {/* 媒体图标(中央水印,真实缩略图覆盖时不可见) */}
        <div className="absolute inset-0 flex items-center justify-center text-white/40">
          <ImageIcon className="h-8 w-8" strokeWidth={1.25} />
        </div>

        {/* 状态点(左上角,常驻,小尺寸) */}
        <div className="absolute left-2 top-2 flex items-center gap-1 rounded bg-black/45 px-1.5 py-0.5 backdrop-blur-sm">
          <span className={`h-1.5 w-1.5 rounded-full ${status.dot}`} />
          <span className="text-[10px] font-medium text-white">{status.label}</span>
        </div>

        {/* 媒体张数 (右上,多张时显示) */}
        {item.mediaTotal > 1 && (
          <div className="absolute right-2 top-2 rounded bg-black/45 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-white backdrop-blur-sm">
            {item.mediaIndex}/{item.mediaTotal}
          </div>
        )}

        {/* 视频/GIF 角标 (右下) */}
        {(item.mediaType === "video" || item.mediaType === "gif") && (
          <div className="absolute bottom-2 right-2 inline-flex items-center gap-1 rounded bg-black/55 px-1.5 py-0.5 text-[10px] font-medium text-white backdrop-blur-sm">
            {item.mediaType === "video" ? (
              <Play className="h-2.5 w-2.5 fill-white" strokeWidth={0} />
            ) : (
              <span className="font-bold">GIF</span>
            )}
            {item.duration && <span className="tabular-nums">{item.duration}</span>}
          </div>
        )}

        {/* 选中态勾选 (左上角覆盖状态点) */}
        {selected && (
          <div className="absolute left-2 top-2 flex h-5 w-5 items-center justify-center rounded-full bg-[hsl(206_100%_49%)] text-white shadow-md">
            <CheckCircle2 className="h-4 w-4" strokeWidth={3} />
          </div>
        )}

        {/* hover overlay */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 translate-y-full bg-gradient-to-t from-black/85 via-black/60 to-transparent p-3 opacity-0 transition-all duration-200 ease-out group-hover:translate-y-0 group-hover:opacity-100">
          <div className="text-xs font-medium text-white/80">@{item.author}</div>
          <div className="mt-0.5 line-clamp-2 text-sm font-semibold text-white">
            {item.caption}
          </div>
          <div className="mt-1 text-[10px] tabular-nums text-white/65">
            {item.publishedAt}
          </div>
          <div className="pointer-events-auto mt-2 flex items-center gap-1">
            <OverlayBtn icon={Eye} label="详情" />
            <OverlayBtn icon={Copy} label="复制 ID" />
            <OverlayBtn icon={ExternalLink} label="原链接" />
          </div>
        </div>
      </div>
    </div>
  );
}

function OverlayBtn({ icon: Icon, label }: { icon: typeof Eye; label: string }) {
  return (
    <button
      title={label}
      aria-label={label}
      onClick={(e) => e.stopPropagation()}
      className="inline-flex items-center gap-1 rounded-md bg-white/95 px-2 py-1 text-[11px] font-medium text-[hsl(215_28%_17%)] transition-all duration-fast hover:-translate-y-px hover:bg-white hover:shadow-md"
    >
      <Icon className="h-3 w-3" />
      {label}
    </button>
  );
}

/** ui-next/filter-chip.tsx — chip 形式多选状态 */
function FilterChip({
  active,
  onClick,
  children,
  count,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  count?: number;
}) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-all duration-fast focus:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(206_100%_49%/0.5)] focus-visible:ring-offset-1 ${
        active
          ? "border-[hsl(206_100%_49%)] bg-[hsl(206_100%_49%/0.08)] text-[hsl(206_100%_49%)]"
          : "border-[hsl(214_22%_92%)] bg-white text-[hsl(215_16%_38%)] hover:border-[hsl(214_16%_84%)] hover:text-[hsl(215_28%_17%)] dark:border-[hsl(215_18%_22%)] dark:bg-[hsl(215_24%_12%)] dark:text-[hsl(215_12%_70%)]"
      }`}
    >
      {children}
      {count !== undefined && (
        <span
          className={`rounded px-1 text-[10px] tabular-nums ${
            active ? "bg-[hsl(206_100%_49%/0.15)]" : "bg-[hsl(214_32%_96%)] text-[hsl(215_12%_56%)] dark:bg-[hsl(215_20%_18%)]"
          }`}
        >
          {count}
        </span>
      )}
    </button>
  );
}

/** 顶部 sticky filter bar */
function FilterBar({
  activeStatuses,
  setActiveStatuses,
  query,
  setQuery,
  appliedCount,
  onClear,
}: {
  activeStatuses: Set<MediaStatus | "all">;
  setActiveStatuses: (s: Set<MediaStatus | "all">) => void;
  query: string;
  setQuery: (q: string) => void;
  appliedCount: number;
  onClear: () => void;
}) {
  return (
    <div className="sticky top-0 z-20 -mx-6 mb-1 border-b border-[hsl(214_22%_92%)] bg-white/85 px-6 py-3 backdrop-blur-md dark:border-[hsl(215_18%_22%)] dark:bg-[hsl(215_28%_9%)]/85">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        {/* 搜索 */}
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[hsl(215_12%_56%)]" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索作者、文本、tweet ID…"
            className="h-8 w-full rounded-md border border-[hsl(214_22%_92%)] bg-white pl-8 pr-3 text-sm text-[hsl(215_28%_17%)] placeholder-[hsl(215_12%_56%)] transition-all duration-fast focus:border-[hsl(206_100%_49%)] focus:outline-none focus:ring-2 focus:ring-[hsl(206_100%_49%/0.5)] dark:border-[hsl(215_18%_22%)] dark:bg-[hsl(215_24%_12%)] dark:text-[hsl(210_20%_96%)]"
          />
          <kbd className="absolute right-2 top-1/2 hidden -translate-y-1/2 rounded bg-[hsl(214_32%_96%)] px-1.5 py-0.5 text-[10px] font-mono text-[hsl(215_12%_56%)] sm:inline-block dark:bg-[hsl(215_20%_18%)]">
            /
          </kbd>
        </div>

        {/* 状态 chip 多选 */}
        <div className="flex flex-wrap items-center gap-1.5">
          <ListFilter className="h-3.5 w-3.5 shrink-0 text-[hsl(215_12%_56%)]" />
          {FILTER_STATUSES.map((s) => (
            <FilterChip
              key={s.key}
              active={activeStatuses.has(s.key)}
              onClick={() => {
                const n = new Set(activeStatuses);
                if (s.key === "all") {
                  setActiveStatuses(new Set(["all"]));
                  return;
                }
                n.delete("all");
                if (n.has(s.key)) n.delete(s.key);
                else n.add(s.key);
                if (n.size === 0) n.add("all");
                setActiveStatuses(n);
              }}
            >
              {s.label}
            </FilterChip>
          ))}
        </div>

        {/* 高级筛选 + 清空 */}
        <div className="ml-auto flex items-center gap-2">
          <button className="inline-flex items-center gap-1 rounded-md border border-[hsl(214_22%_92%)] bg-white px-2.5 py-1 text-xs font-medium text-[hsl(215_16%_38%)] transition-all duration-fast hover:border-[hsl(214_16%_84%)] hover:text-[hsl(215_28%_17%)] dark:border-[hsl(215_18%_22%)] dark:bg-[hsl(215_24%_12%)] dark:text-[hsl(215_12%_70%)]">
            <SlidersHorizontal className="h-3 w-3" />
            日期 · 来源 · 类型
            <ChevronDown className="h-3 w-3" />
          </button>
          {appliedCount > 0 && (
            <>
              <span className="rounded-md bg-[hsl(206_100%_49%/0.08)] px-2 py-1 text-xs font-medium text-[hsl(206_100%_49%)]">
                已应用 {appliedCount} 个筛选
              </span>
              <button
                onClick={onClear}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-[hsl(215_16%_38%)] transition-colors duration-fast hover:bg-[hsl(214_32%_96%)] hover:text-[hsl(215_28%_17%)] dark:text-[hsl(215_12%_70%)] dark:hover:bg-[hsl(215_20%_18%)]"
              >
                <X className="h-3 w-3" />
                清空
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** 视图切换 + 排序 + 总数 */
function ToolbarRow({
  total,
  view,
  setView,
}: {
  total: number;
  view: "grid" | "list";
  setView: (v: "grid" | "list") => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <div className="text-sm text-[hsl(215_16%_38%)] dark:text-[hsl(215_12%_70%)]">
        共找到 <span className="font-semibold tabular-nums text-[hsl(215_28%_17%)] dark:text-[hsl(210_20%_96%)]">{total.toLocaleString()}</span> 条媒体
      </div>
      <div className="flex items-center gap-2">
        <button className="inline-flex items-center gap-1 rounded-md border border-[hsl(214_22%_92%)] bg-white px-2.5 py-1 text-xs font-medium text-[hsl(215_16%_38%)] transition-all duration-fast hover:border-[hsl(214_16%_84%)] hover:text-[hsl(215_28%_17%)] dark:border-[hsl(215_18%_22%)] dark:bg-[hsl(215_24%_12%)] dark:text-[hsl(215_12%_70%)]">
          排序: 最新优先
          <ChevronDown className="h-3 w-3" />
        </button>
        <div className="inline-flex rounded-md border border-[hsl(214_22%_92%)] bg-white p-0.5 dark:border-[hsl(215_18%_22%)] dark:bg-[hsl(215_24%_12%)]">
          <ToggleViewBtn active={view === "grid"} onClick={() => setView("grid")} icon={Grid3x3} label="网格" />
          <ToggleViewBtn active={view === "list"} onClick={() => setView("list")} icon={LayoutList} label="列表" />
        </div>
      </div>
    </div>
  );
}

function ToggleViewBtn({
  active,
  onClick,
  icon: Icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof Grid3x3;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      className={`inline-flex h-6 w-7 items-center justify-center rounded transition-all duration-fast ${
        active
          ? "bg-[hsl(206_100%_49%/0.10)] text-[hsl(206_100%_49%)]"
          : "text-[hsl(215_12%_56%)] hover:text-[hsl(215_28%_17%)] dark:hover:text-[hsl(210_20%_96%)]"
      }`}
    >
      <Icon className="h-3.5 w-3.5" />
    </button>
  );
}

/** Compact List 视图 */
function CompactList({
  items,
  selected,
  toggleSelect,
}: {
  items: MediaItem[];
  selected: Set<string>;
  toggleSelect: (id: string) => void;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-[hsl(214_22%_92%)] bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:border-[hsl(215_18%_22%)] dark:bg-[hsl(215_24%_12%)]">
      <div className="grid grid-cols-[40px_72px_1fr_120px_120px_100px] gap-3 border-b border-[hsl(214_22%_92%)] bg-[hsl(210_20%_98%)] px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-[hsl(215_16%_38%)] dark:border-[hsl(215_18%_22%)] dark:bg-[hsl(215_22%_16%)] dark:text-[hsl(215_12%_70%)]">
        <span></span>
        <span>预览</span>
        <span>媒体</span>
        <span>作者</span>
        <span>时间</span>
        <span>状态</span>
      </div>
      {items.map((item) => {
        const status = STATUS_CONFIG[item.status];
        return (
          <div
            key={item.id}
            onClick={() => toggleSelect(item.id)}
            className={`group grid cursor-pointer grid-cols-[40px_72px_1fr_120px_120px_100px] items-center gap-3 border-b border-[hsl(214_22%_92%)] px-4 py-2.5 transition-colors duration-fast last:border-b-0 hover:bg-[hsl(214_32%_96%)] dark:border-[hsl(215_18%_22%)] dark:hover:bg-[hsl(215_20%_18%)] ${
              selected.has(item.id) ? "bg-[hsl(206_100%_49%/0.04)]" : ""
            }`}
          >
            <input
              type="checkbox"
              checked={selected.has(item.id)}
              readOnly
              className="h-4 w-4 rounded border-[hsl(214_16%_84%)] text-[hsl(206_100%_49%)] focus:ring-[hsl(206_100%_49%/0.5)]"
            />
            <div
              className="aspect-square w-12 rounded-md"
              style={{
                background: `linear-gradient(135deg, hsl(${item.hue} 50% 65%) 0%, hsl(${(item.hue + 60) % 360} 55% 50%) 100%)`,
              }}
            />
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                {item.mediaType === "video" && <Play className="h-3 w-3 fill-[hsl(215_16%_38%)] text-[hsl(215_16%_38%)]" strokeWidth={0} />}
                {item.mediaType === "gif" && <span className="rounded bg-[hsl(214_32%_96%)] px-1 text-[10px] font-bold text-[hsl(215_16%_38%)] dark:bg-[hsl(215_20%_18%)]">GIF</span>}
                <span className="truncate text-sm font-medium text-[hsl(215_28%_17%)] dark:text-[hsl(210_20%_96%)]">{item.caption}</span>
              </div>
              <code className="font-mono text-[10px] text-[hsl(215_12%_56%)]">{item.tweetId}</code>
            </div>
            <span className="text-sm font-medium text-[hsl(206_100%_49%)]">@{item.author}</span>
            <span className="font-mono text-xs tabular-nums text-[hsl(215_16%_38%)] dark:text-[hsl(215_12%_70%)]">{item.publishedAt}</span>
            <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium ${status.bg} ${status.text} w-fit`}>
              <span className={`h-1.5 w-1.5 rounded-full ${status.dot}`} />
              {status.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** 浮动 batch dock */
function BatchDock({
  count,
  onClear,
}: {
  count: number;
  onClear: () => void;
}) {
  if (count === 0) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-30 flex justify-center">
      <div className="pointer-events-auto inline-flex items-center gap-2 rounded-xl border border-[hsl(214_22%_92%)] bg-white/95 px-3 py-2 shadow-[0_12px_32px_rgba(15,23,42,0.10)] backdrop-blur-md dark:border-[hsl(215_18%_22%)] dark:bg-[hsl(215_22%_16%)]/95">
        <div className="inline-flex h-7 items-center gap-1.5 rounded-md bg-[hsl(206_100%_49%/0.10)] px-2 text-xs font-semibold text-[hsl(206_100%_49%)]">
          <CheckCircle2 className="h-3.5 w-3.5" />
          已选 {count} 项
        </div>
        <span className="h-5 w-px bg-[hsl(214_22%_92%)] dark:bg-[hsl(215_18%_22%)]" />
        <DockBtn icon={RotateCcw} label="重新归档" />
        <DockBtn icon={Download} label="导出 CSV" />
        <DockBtn icon={Trash2} label="删除" tone="danger" />
        <span className="h-5 w-px bg-[hsl(214_22%_92%)] dark:bg-[hsl(215_18%_22%)]" />
        <button
          onClick={onClear}
          className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium text-[hsl(215_16%_38%)] transition-colors hover:bg-[hsl(214_32%_96%)] hover:text-[hsl(215_28%_17%)] dark:text-[hsl(215_12%_70%)] dark:hover:bg-[hsl(215_20%_18%)]"
        >
          <X className="h-3 w-3" />
          取消
        </button>
      </div>
    </div>
  );
}

function DockBtn({ icon: Icon, label, tone }: { icon: typeof Download; label: string; tone?: "danger" }) {
  const cls =
    tone === "danger"
      ? "text-[hsl(354_76%_52%)] hover:bg-[hsl(354_76%_52%/0.08)]"
      : "text-[hsl(215_28%_17%)] hover:bg-[hsl(214_32%_96%)] dark:text-[hsl(210_20%_96%)] dark:hover:bg-[hsl(215_20%_18%)]";
  return (
    <button className={`inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium transition-colors duration-fast ${cls}`}>
      <Icon className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}

/** 分页 + 跳转 */
function Pagination() {
  return (
    <div className="flex items-center justify-between border-t border-[hsl(214_22%_92%)] py-4 dark:border-[hsl(215_18%_22%)]">
      <span className="text-xs text-[hsl(215_12%_56%)] tabular-nums">显示 1–48 / 共 12,438 条</span>
      <div className="inline-flex items-center gap-1">
        <PageBtn disabled><ChevronLeft className="h-3.5 w-3.5" /></PageBtn>
        <PageBtn active>1</PageBtn>
        <PageBtn>2</PageBtn>
        <PageBtn>3</PageBtn>
        <span className="px-1 text-xs text-[hsl(215_12%_56%)]">…</span>
        <PageBtn>259</PageBtn>
        <PageBtn><ChevronRight className="h-3.5 w-3.5" /></PageBtn>
        <span className="ml-2 inline-flex items-center gap-1.5 text-xs text-[hsl(215_16%_38%)] dark:text-[hsl(215_12%_70%)]">
          跳转
          <input
            type="text"
            placeholder="页码"
            className="h-6 w-14 rounded-md border border-[hsl(214_22%_92%)] bg-white px-1.5 text-center text-xs tabular-nums focus:border-[hsl(206_100%_49%)] focus:outline-none focus:ring-2 focus:ring-[hsl(206_100%_49%/0.5)] dark:border-[hsl(215_18%_22%)] dark:bg-[hsl(215_24%_12%)]"
          />
        </span>
      </div>
    </div>
  );
}

function PageBtn({ children, active, disabled }: { children: React.ReactNode; active?: boolean; disabled?: boolean }) {
  return (
    <button
      disabled={disabled}
      className={`inline-flex h-7 min-w-[28px] items-center justify-center rounded-md px-2 text-xs font-medium transition-colors duration-fast ${
        active
          ? "bg-[hsl(206_100%_49%)] text-white"
          : disabled
          ? "text-[hsl(215_12%_56%)] opacity-40"
          : "text-[hsl(215_16%_38%)] hover:bg-[hsl(214_32%_96%)] hover:text-[hsl(215_28%_17%)] dark:text-[hsl(215_12%_70%)] dark:hover:bg-[hsl(215_20%_18%)]"
      }`}
    >
      {children}
    </button>
  );
}

// ===========================================================================
// 页面
// ===========================================================================

export default function LibraryMock() {
  const [view, setView] = useState<"grid" | "list">("grid");
  const [activeStatuses, setActiveStatuses] = useState<Set<MediaStatus | "all">>(new Set(["verified", "pending", "failed"]));
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set(["m2", "m6", "m13"]));

  const filtered = useMemo(() => {
    return MEDIA.filter((m) => {
      if (!activeStatuses.has("all") && !activeStatuses.has(m.status)) return false;
      if (query && !`${m.author} ${m.caption} ${m.tweetId}`.toLowerCase().includes(query.toLowerCase())) return false;
      return true;
    });
  }, [activeStatuses, query]);

  const appliedCount = (activeStatuses.has("all") ? 0 : activeStatuses.size) + (query ? 1 : 0);

  const toggleSelect = (id: string) => {
    const n = new Set(selected);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    setSelected(n);
  };

  return (
    <div className="min-h-screen bg-[hsl(210_20%_98%)] dark:bg-[hsl(215_28%_9%)]">
      <div className="mx-auto max-w-[1440px] px-6 py-6">
        {/* 页头 */}
        <header className="mb-4 flex items-end justify-between">
          <div>
            <h1 className="text-2xl font-bold leading-tight text-[hsl(215_28%_17%)] dark:text-[hsl(210_20%_96%)]">
              媒体库
            </h1>
            <p className="mt-1 text-sm text-[hsl(215_16%_38%)] dark:text-[hsl(215_12%_70%)]">
              浏览、筛选与管理所有已归档的 X 媒体
            </p>
          </div>
        </header>

        {/* Sticky filter bar */}
        <FilterBar
          activeStatuses={activeStatuses}
          setActiveStatuses={setActiveStatuses}
          query={query}
          setQuery={setQuery}
          appliedCount={appliedCount}
          onClear={() => {
            setActiveStatuses(new Set(["all"]));
            setQuery("");
          }}
        />

        {/* Toolbar row */}
        <div className="mt-4 mb-3">
          <ToolbarRow total={filtered.length * 779} view={view} setView={setView} />
        </div>

        {/* 主体 */}
        {view === "grid" ? (
          <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
            {filtered.map((item) => (
              <MediaThumbnail
                key={item.id}
                item={item}
                selected={selected.has(item.id)}
                onSelect={() => toggleSelect(item.id)}
              />
            ))}
          </div>
        ) : (
          <CompactList items={filtered} selected={selected} toggleSelect={toggleSelect} />
        )}

        <Pagination />
      </div>

      <BatchDock count={selected.size} onClear={() => setSelected(new Set())} />
    </div>
  );
}
