# WebUI Component Inventory — 旧组件迁移与 ui 清单

> 版本: v1.0  
> 日期: 2026-05-28  
> 主文档: [phase-4-ui-revamp-plan.md](./phase-4-ui-revamp-plan.md)  
> 配套: [design-system-tokens.md](./design-system-tokens.md)

本文档是 Phase 4 重构期的"对照表":每个旧组件迁移到哪个新组件、何时迁移、需要哪些新增组件、依赖如何变化、每个页面用到哪些 ui 组件。实施 PR 应**对照本文档逐项打勾**。

---

## 一、ui 引入策略与目录约定

### 1.1 目录结构

```
webui/src/components/
├── ui/                # 旧组件,保留不动,M3 完成后整体删除
│   ├── Button.tsx
│   ├── Card.tsx
│   └── ...
├── ui/           # 新组件,本期主战场
│   ├── button.tsx     # 文件名小写(shadcn 风格)
│   ├── card.tsx
│   ├── ...
│   └── _utils/
│       ├── cn.ts      # clsx + tailwind-merge
│       └── cva.ts     # class-variance-authority 重导出
└── layout/            # 布局组件,M3 重构
    └── AppLayout.tsx
```

### 1.2 引用约束

- **新页面 / 重构页面**: 只允许 `import { Button } from "@/components/ui/button"`(必要时配 Vite alias `@`)
- **未重构页面**: 继续用旧 `import { Button } from "../components/ui/Button"`,不混用
- **每个 PR 限制只动一页** — 整页切换,避免新旧混搭

### 1.3 引入步骤(M1 第 1 天)

1. `npm i clsx tailwind-merge class-variance-authority lucide-react`
2. `npm i @radix-ui/react-{dialog,popover,select,tabs,tooltip,dropdown-menu,checkbox,switch}`
3. `npm i sonner cmdk`
4. `npm i @tanstack/react-table` (M2 Library 用)
5. `npm i react-virtuoso` (M2 Library/Queue/Sources 用)
6. `npm i recharts` (M1 Dashboard 用)
7. 用 shadcn CLI 复制源码到 `ui/`(或手动复制):`npx shadcn@latest add button card input select badge dialog sheet tabs tooltip command table skeleton popover dropdown-menu checkbox switch`
8. 改造每个组件:把 `text-foreground` 等 shadcn 默认 token 替换为本项目 token(`text-fg-primary` / `bg-bg-surface` 等),参考 [design-system-tokens.md §9](./design-system-tokens.md#%E4%B9%9D%E3%80%81token-%E5%91%BD%E5%90%8D%E7%BA%A6%E5%AE%9A-%E4%BE%9B-ui-%E5%AE%9E%E6%96%BD)

---

## 二、shadcn 基础组件清单 (17 个)

| # | 组件 | 路径 | Radix 依赖 | 重点改造 |
|---|---|---|---|---|
| 1 | Button | `ui/button.tsx` | — | CVA variants: `default`/`secondary`/`outline`/`ghost`/`destructive` + sizes `sm`/`md`/`lg`/`icon` |
| 2 | Card | `ui/card.tsx` | — | `rounded-lg shadow-1 border-subtle`,补 `CardDescription` |
| 3 | Input | `ui/input.tsx` | — | 支持前后缀图标(InputAdornment 模式) |
| 4 | Select | `ui/select.tsx` | `@radix-ui/react-select` | 替代原生 select,支持搜索过滤 |
| 5 | Badge | `ui/badge.tsx` | — | tone variants: `default`/`secondary`/`success`/`warning`/`danger` |
| 6 | Dialog | `ui/dialog.tsx` | `@radix-ui/react-dialog` | 自动 ESC + 遮罩 + focus trap,`rounded-xl shadow-3` |
| 7 | Sheet | `ui/sheet.tsx` | `@radix-ui/react-dialog` | 右侧抽屉,`ease-spring` 入场 |
| 8 | Tabs | `ui/tabs.tsx` | `@radix-ui/react-tabs` | 下划线 active 风格(brand 色),非按钮风格 |
| 9 | Tooltip | `ui/tooltip.tsx` | `@radix-ui/react-tooltip` | `shadow-2 rounded-md text-xs` |
| 10 | Toast (sonner) | `ui/toaster.tsx` | sonner | 右上堆叠,success/error/info/loading 四态 |
| 11 | Command | `ui/command.tsx` | cmdk | M3 CommandPalette 基底 |
| 12 | Table | `ui/table.tsx` | — | 配 TanStack Table v8 包装为 DataTable |
| 13 | Skeleton | `ui/skeleton.tsx` | — | 加 `animate-shimmer` |
| 14 | Popover | `ui/popover.tsx` | `@radix-ui/react-popover` | 筛选下拉、迷你菜单 |
| 15 | DropdownMenu | `ui/dropdown-menu.tsx` | `@radix-ui/react-dropdown-menu` | 行操作菜单 |
| 16 | Checkbox | `ui/checkbox.tsx` | `@radix-ui/react-checkbox` | DataTable 选中、批量操作 |
| 17 | Switch | `ui/switch.tsx` | `@radix-ui/react-switch` | Sources 启用/禁用开关 |

---

## 三、新增业务组件 (10 个)

| # | 组件 | 路径 | 阶段 | 输入 props | 用途 |
|---|---|---|---|---|---|
| 1 | StatCard | `ui/stat-card.tsx` | M1 | `{ label, value, sparklineData?, trend?, tone? }` | Dashboard 统计卡:label + 大数字 + sparkline + 趋势百分比/箭头 |
| 2 | Sparkline | `ui/sparkline.tsx` | M1 | `{ data: number[], color?, height? }` | SVG path 实现,无依赖,30 数据点折线 |
| 3 | StatusDot | `ui/status-dot.tsx` | M1 | `{ status: "running"\|"success"\|"warning"\|"danger"\|"idle" }` | 替代纯文字状态,running 态 `animate-breathe` |
| 4 | LiveIndicator | `ui/live-indicator.tsx` | M1 | `{ state: "connecting"\|"open"\|"reconnecting"\|"closed" }` | SSE 连接状态指示 |
| 5 | MediaThumbnail | `ui/media-thumbnail.tsx` | M2 | `{ src, alt, mediaType, blurHash?, onClick? }` | 统一缩略图:loading / error / blur-up + 视频/GIF 角标 |
| 6 | DataTable | `ui/data-table.tsx` | M2 | `{ columns, data, virtualizer?, onRowClick?, ... }` | 基于 TanStack Table v8 + Table 包装,支持排序/选中/虚拟滚动 |
| 7 | ProgressRing | `ui/progress-ring.tsx` | M2 | `{ value, size?, strokeWidth? }` | SVG 圆环进度,Queue Hero 用 |
| 8 | CommandPalette | `ui/command-palette.tsx` | M3 | `{ open, onOpenChange, commands }` | Cmd+K 全局搜索/跳转,基于 cmdk |
| 9 | EmptyState | `ui/empty-state.tsx` | M3 | `{ icon, title, description?, action? }` | 升级旧版,加 lucide 图标 + CTA |
| 10 | ErrorState | `ui/error-state.tsx` | M3 | `{ title, detail?, onRetry? }` | 升级旧版,加重试按钮 |

### 3.1 关键 hook

| Hook | 路径 | 阶段 | 用途 |
|---|---|---|---|
| `useEventStream(topics: string[])` | `webui/src/lib/hooks/useEventStream.ts` | M1 | SSE 单一长连接 + topic 订阅 + 自动重连 + React Query cache invalidate |
| `useTheme()` | `webui/src/lib/hooks/useTheme.ts` | M1 | 读写主题(light/dark/system),首次加载防 FOUC |
| `useVirtualizer()` | `react-virtuoso` 已自带 | M2 | Library/Queue/Sources 长列表 |
| `useCommandPalette()` | `webui/src/lib/hooks/useCommandPalette.ts` | M3 | 注册命令、Cmd+K 唤起 |

---

## 四、旧 → 新组件迁移映射

| 旧 (`components/ui/`) | 新 (`components/ui/`) | 迁移阶段 | 关键差异与注意点 |
|---|---|---|---|
| `Button.tsx` (3 variants) | `button.tsx` (5 variants × 4 sizes) | M2 起 | CVA 重写;旧 `primary`/`secondary`/`ghost` 映射到新 `default`/`secondary`/`ghost`,新增 `outline`/`destructive` |
| `Card.tsx` | `card.tsx` | M2 起 | 圆角从 `md` 升到 `lg`;补 `CardDescription`;hover 升 elevation |
| `Input.tsx` | `input.tsx` | M2 起 | 支持前后缀图标(`<Input.Prefix>` 模式);focus-ring 用 brand |
| `Select.tsx` (原生 select) | `select.tsx` (Radix) | M2 起 | API 由原生 `<option>` 改 Radix 子组件,支持搜索 |
| `Badge.tsx` (单色) | `badge.tsx` (5 tone) | M2 起 | tone: `default`/`secondary`/`success`/`warning`/`danger` |
| `Dialog.tsx` | `dialog.tsx` | M2 起 | 自动 focus trap + ESC,圆角 xl,shadow-3 |
| `ConfirmDialog.tsx` | `confirm-dialog.tsx` | M3 | tone: `info`/`warning`/`danger`,danger 强制输词验证 |
| `Toast.tsx` (自实现) | sonner (`<Toaster />`) | M3 | 改用 `toast.success()` / `toast.error()` API |
| `PaginationBar.tsx` | `pagination.tsx` | M2 起 | 加"跳转到第 N 页"输入框 |
| `EmptyState.tsx` | `empty-state.tsx` | M3 | 加 lucide 图标 + CTA |
| `ErrorState.tsx` | `error-state.tsx` | M3 | 加重试按钮 |
| `Skeleton.tsx` | `skeleton.tsx` | M1 | 加 `animate-shimmer` |

### 4.1 删除旧组件的时机

M3 完成后(所有 8 页面已切换到 ui),整体删除 `webui/src/components/ui/`,同时删除 [`styles.css`](../../webui/src/styles.css) 中的 legacy token 映射段。

---

## 五、八页面组件使用指南

每个页面在重构时用到哪些 ui 组件,作为 PR 提交清单的对照。

### 5.1 Dashboard `/` (M1)

| 组件 | 用途 |
|---|---|
| StatCard × 4 | 进行中 / 失败队列 / 重复待处理 / 24h 新增 |
| Sparkline | 每张 StatCard 内嵌的迷你图 |
| LiveIndicator | 顶部 SSE 连接状态 |
| StatusDot | 最近事件流的状态前缀 |
| Recharts PieChart | Tweet 状态分布 donut |
| Recharts BarChart | 24h 归档活动堆叠柱状 |
| Tabs | 最近导出 / 最近失败 切换 |
| Card | 容器 |
| Badge | 状态徽章 |

### 5.2 Library `/library` (M2)

| 组件 | 用途 |
|---|---|
| MediaThumbnail | 网格缩略图 + hover overlay |
| DataTable | Compact List 视图 |
| react-virtuoso | 网格虚拟滚动 |
| Sheet | 详情快开抽屉 |
| Popover | 筛选下拉 |
| Checkbox | 多选 |
| Badge | 媒体类型/状态 chip |
| Input + Select | sticky 筛选表单 |
| Pagination | 分页 + 跳转 |
| Skeleton | 加载占位 |
| EmptyState / ErrorState | 空态/错误态 |

### 5.3 TweetDetail `/tweets/:tweetId` (M3)

| 组件 | 用途 |
|---|---|
| Card | 元数据区 |
| MediaThumbnail + Dialog | 媒体网格 + lightbox |
| Badge + StatusDot | 状态展示 |
| Tooltip | 操作按钮提示 |
| Button | 重试 / 复制 / 打开原链接 |

### 5.4 Failures `/failures` (M3)

| 组件 | 用途 |
|---|---|
| Card × 5 | top 5 错误码聚合 |
| DataTable | 失败列表 |
| Badge | 错误分类 |
| Checkbox | 批量重试选中 |
| Button | inline 重试 / 批量重试 |
| DropdownMenu | 行操作 |

### 5.5 Duplicates `/duplicates` (M3)

| 组件 | 用途 |
|---|---|
| Card | 双栏对比容器 |
| MediaThumbnail | 并排缩略图 |
| Badge | 哈希匹配度 |
| Button | 合并 / 保留 |
| ConfirmDialog | 危险操作确认 |

### 5.6 Operations `/operations` (M3)

| 组件 | 用途 |
|---|---|
| Tabs × 3 | 维护操作 / 系统状态 / 数据库工具 |
| Card | 每个操作卡 |
| Badge | 危险等级 |
| Button | 触发操作 |
| ConfirmDialog | danger tone 强制输词 |
| Sparkline | 系统状态趋势 |
| StatCard | CPU / 磁盘 / DB pool |
| StatusDot | Worker 心跳 |

### 5.7 ArchiveQueue `/queue` (M2)

| 组件 | 用途 |
|---|---|
| ProgressRing | Hero 进行中任务进度 |
| StatCard | 队列长度 / 速率 / ETA |
| Tabs | 运行中 / 已完成 / 失败 / 全部 |
| DataTable | 任务列表(支持行展开看 items) |
| react-virtuoso | 大列表虚拟滚动 |
| Sheet | 行点击打开详情 |
| Badge + StatusDot | 状态展示 |
| LiveIndicator | SSE 进度更新 |

### 5.8 Sources `/sources` (M2)

| 组件 | 用途 |
|---|---|
| DataTable | 左侧源列表 |
| Tabs × 4 | 详情 panel:概览 / 发现 tweet / 扫描历史 / 配置 |
| Card | 详情各区块 |
| Switch | 启用/禁用源 |
| Button + ProgressRing | 立即扫描按钮 + 进度反馈 |
| Badge + StatusDot | 健康徽章 + 待归档徽章 |
| ConfirmDialog | 删除源确认 |
| Dialog | 创建源表单 |
| Input + Select | 配置表单 |

### 5.9 拆分后的子组件 (代码组织)

Sources 与 Operations 单文件过大(754 / 522 行),按以下结构拆:

```
webui/src/pages/sources/
├── SourcesPage.tsx              # 容器,< 200 行
├── components/
│   ├── SourcesList.tsx
│   ├── SourceDetailPanel.tsx
│   ├── SourceTweetsTab.tsx
│   ├── SourceScanHistoryTab.tsx
│   └── CreateSourceDialog.tsx
└── hooks/
    ├── useSourcesQuery.ts
    ├── useSourceDetail.ts
    └── useSourceScan.ts

webui/src/pages/operations/
├── OperationsPage.tsx           # 容器,< 150 行
├── tabs/
│   ├── MaintenanceTab.tsx
│   ├── SystemStatusTab.tsx
│   └── DatabaseTab.tsx
└── hooks/
    ├── useMaintenanceOps.ts
    └── useSystemHealth.ts
```

ArchiveQueue 类似拆 `queue/components/{QueueHero, RunningTab, HistoryTab, RunDetailSheet}` + `queue/hooks/{useQueueRuns, useRunDetail}`。

---

## 六、图表库选型说明

**选 Recharts**。理由:

| 候选 | 优点 | 缺点 | 评分 |
|---|---|---|---|
| Recharts | React 原生,API 简洁,tree-shake 后可控,生态成熟 | 体积稍大(基础约 90KB gzip),复杂场景灵活性一般 | ✅ |
| visx | 灵活度极高,airbnb 出品 | 学习曲线陡,需自己组合,本项目只用基础图浪费 | ✗ |
| uPlot | 极致性能与体积 | API 命令式,与 React 集成需手动包装,定制度低 | ✗ |
| ECharts | 功能最全 | 体积大(500KB+),非 React 原生 | ✗ |

**按需 import 示例**:

```tsx
// 仅 import 需要的图表,而非整个 recharts
import { LineChart, Line, ResponsiveContainer } from "recharts";
// 不要写 import * as Recharts from "recharts"
```

**Dashboard 路由独立 chunk**:

```ts
// webui/src/main.tsx
const DashboardPage = lazy(() => import("./pages/DashboardPage"));
```

Vite 自动拆 chunk,首屏不加载图表代码。

**体积红线**: 若 Dashboard chunk > 100KB(gzip 后),改 uPlot。

---

## 七、依赖增量清单

### 7.1 生产依赖 (M1 一次性安装)

```
"clsx": "^2.x",
"tailwind-merge": "^2.x",
"class-variance-authority": "^0.7.x",
"lucide-react": "^0.x",
"sonner": "^1.x",
"cmdk": "^1.x",
"react-virtuoso": "^4.x",
"recharts": "^2.x",
"@tanstack/react-table": "^8.x",
"@radix-ui/react-dialog": "^1.x",
"@radix-ui/react-popover": "^1.x",
"@radix-ui/react-select": "^2.x",
"@radix-ui/react-tabs": "^1.x",
"@radix-ui/react-tooltip": "^1.x",
"@radix-ui/react-dropdown-menu": "^2.x",
"@radix-ui/react-checkbox": "^1.x",
"@radix-ui/react-switch": "^1.x"
```

总计 17 个生产依赖。所有都是 shadcn/ui 标准套件,无冷门或维护差包。

### 7.2 体积预算

| 模块 | 预算 (gzip 后) |
|---|---|
| Dashboard chunk (含 Recharts) | < 100 KB |
| Library chunk (含 react-virtuoso) | < 60 KB |
| Sources chunk | < 50 KB |
| 公共 chunk (含 ui 基础) | < 80 KB |
| 总首屏 | < 200 KB |

实施时用 `npm run build` 后看 `dist/assets/*.js` 大小,超限触发回滚或拆 chunk。

---

## 八、迁移 Checklist (PR 模板)

每个重构 PR 必须勾选:

- [ ] 只动一个页面(检查 `git diff --stat`)
- [ ] 该页面**完全**切换到 `ui/`,无残留旧组件引用(`grep "components/ui/" webui/src/pages/<page>/`)
- [ ] 新组件源码无颜色/字号/阴影魔数(全走 token)
- [ ] hover/focus/active 状态齐全(三态截图附 PR)
- [ ] 空态 / 错误态 / 骨架屏全部新版
- [ ] 亮色 + 暗色双主题截图附 PR
- [ ] 键盘 Tab/Enter/ESC 操作可达
- [ ] `npm run typecheck` 与 `npm run build` 全绿
- [ ] zh-CN / en 文案全翻译
- [ ] 体积变化记录(`dist/` chunk 大小对比)

---

## 九、相关文件索引

- 当前样式定义: [`webui/src/styles.css`](../../webui/src/styles.css)
- Tailwind 配置: [`webui/tailwind.config.js`](../../webui/tailwind.config.js)
- 当前组件目录: [`webui/src/components/ui/`](../../webui/src/components/ui/)
- 当前 8 页面: [`webui/src/pages/`](../../webui/src/pages/)
- i18n: [`webui/src/lib/i18n.ts`](../../webui/src/lib/i18n.ts)
- 类型: [`webui/src/api/generated.ts`](../../webui/src/api/generated.ts)
- package.json: [`webui/package.json`](../../webui/package.json)
