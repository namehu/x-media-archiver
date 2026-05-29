# Phase 4 升级迭代计划:WebUI 视觉重构与后端隐患收口

> 版本: v1.0  
> 日期: 2026-05-28  
> 衔接: [phase-3.4-plan.md](./phase-3.4-plan.md) 之后的下一阶段主线  
> 配套子文档: [design-system-tokens.md](./design-system-tokens.md) · [webui-component-inventory.md](./webui-component-inventory.md)

---

## 一、背景与目标

P3 阶段 (P3.1–P3.4) 已完成后端 API 收口、结构化日志、SSE 事件流、Operations 页面交互优化与服务层测试补齐。功能层面项目已经接近"可用闭环",但用户在 P4 启动评审时明确反馈:

> "当前页面可以说没有任何设计 太素了 看起来一点都不好"

调研结论:

- **技术栈现代且合理** — React 19 + Vite + Tailwind 3.4 + TanStack Query + 自建 12 个 ui 组件。问题不在架构。
- **真正的短板**: design token 太薄(亮色仅米色 + 深绿,暗色仅深灰 + 浅绿)、无 elevation/motion 体系、无图表与数据可视化、列表/卡片纯文本零层级、加载/错误反馈弱。
- **顺手暴露的后端隐患**: 双 worker daemon 线程崩溃会丢运行中状态;前后端 API 类型靠手动 `npm run generate:api-types` 同步,易漂移。

**Phase 4 目标**:

1. **WebUI 重构 (主线,~70% 工作量)** — 把 WebUI 从"功能可用的管理后台"抬到"精致专业的本地媒体管理控制台",视觉风格定调为 **白蓝清爽风(Pixiv-like)**。
2. **后端 P0/P1 收口 (~30% 工作量)** — 五项克制改造:worker lease 持久化、API 契约 CI 校验、psycopg_pool 连接池、写锁分粒度、媒体代理流式传输。

**明确不做**: 换前端栈、引入 Redis/RQ/MQ、上 pgbouncer、做分布式锁、企业级速率限制 — 单用户本地工具的当前规模都用不上。

---

## 二、决策记录 (用户已确认)

| 决策点 | 选择 | 简述 |
|---|---|---|
| 视觉风格 | **白蓝清爽风 (Pixiv-like)** | 亮色为默认主题,Pixiv 蓝 (`hsl(206 100% 49%)` ≈ #0096FA) 为唯一主色,白底 + 浅灰边框 + 极轻阴影,缩略图为视觉主角。暗色按等同质量打磨。 |
| 组件库 | **渐进引入 shadcn/ui** | 新建 `webui/src/components/ui/`,旧 `components/ui/` 保留,M2/M3 重构按页整页切换。 |
| 后端力度 | **克制版 P0/P1 五项** | worker lease + API 契约 CI + psycopg_pool + 写锁分粒度 + 媒体代理流式。 |
| 文档结构 | **三份配套文档** | 主总纲 + Design System 规范 + 组件清单与迁移。 |

---

## 三、整体策略

### 3.1 视觉路线 — 白蓝风的设计立场

参考 Pixiv 的视觉处方:

- **白底为主** — 缩略图与媒体内容是绝对主角,UI chrome 让位
- **Pixiv 蓝单一主色** — 降低视觉负担,告别"蓝灰俗套"
- **高密度 + 字号层次** — 不靠装饰,靠字重/字号/留白制造呼吸
- **扁平为主,elevation 必要处加 1px 阴影**
- **暗色非凑数** — 系统跟随为默认,两套主题同等打磨

**为什么不选其他风格**:

- 深色科技仪表盘:与 Pixiv 蓝立场冲突,且白底对照片缩略图更友好
- 暖色精致工作台:与目标"现代 + 专业"语义略偏
- 极简纯白:留白过大、信息密度低,不适合控制台型应用

### 3.2 组件路线 — ui 共存,整页切换

- 新建 `webui/src/components/ui/`,从 shadcn/ui CLI 复制 17 个组件源码进来 (Button/Card/Input/Select/Badge/Dialog/Sheet/Tabs/Tooltip/Toast(sonner)/Command/Table/Skeleton/Popover/DropdownMenu/Checkbox/Switch),统一接 design system token
- 旧 `components/ui/` 保持不动,M2/M3 重构按页**整页切换**,避免新旧混搭丑陋期
- 每个 PR 限制只动一页,可独立 revert

### 3.3 后端路线 — 仅修真痛点

只做 P0/P1 五项:worker lease 持久化(软心跳)、API 契约 CI 校验、psycopg_pool 连接池、写锁分粒度(按 source_id/run_id)、媒体代理流式传输(Library 重构需要)。

---

## 四、阶段化迭代计划 (4 milestone)

### M1 — Design System 基建 (~5 天) 🎨

**主线交付**:

- 新 token 落入 [`webui/src/styles.css`](../../webui/src/styles.css) 与 [`webui/tailwind.config.js`](../../webui/tailwind.config.js)
- `ui/` 17 组件就位 + 统一 `cn()` / `cva()` 工具
- 新增组件:`StatCard` / `Sparkline` / `MediaThumbnail` / `LiveIndicator` / `StatusDot`
- Recharts 接入(按需 import,Dashboard 独立 chunk)
- `useEventStream(topic)` SSE 单一长连接 hook
- Dashboard 页面用 ui + 新 token 完成首发改版
- 后端 P1: 媒体代理流式 + Range 支持(为 M2 Library 预先解锁)

**用户可感**:

- 主题切换器实时切到 Pixiv 蓝色板
- Dashboard 从"4 个数字 + 一段列表"变成"Hero 数字 + sparkline + 双图表 + 实时事件流"

**M1 验收清单**:

1. ☐ 旧页面(Library/Sources/Operations 等)在新 token 下不破样
2. ☐ Dashboard 首屏 4 张 StatCard 各带 sparkline + 趋势百分比
3. ☐ 主题切换流畅,light/dark 完整覆盖,无闪白
4. ☐ `webui/demo` 路由能预览全部 ui 组件(类 Storybook)
5. ☐ SSE LiveIndicator 在 Dashboard 顶部正确显示连接状态
6. ☐ `curl -H "Range: bytes=0-1023" http://.../media-file/xxx.mp4` 返回 `206 Partial Content`

### M2 — 三大重灾页面重构 (~7 天) 🔥

**主线交付**:

- **Library** [/library](../../webui/src/pages/LibraryPage.tsx):MediaThumbnail + DataTable + react-virtuoso 虚拟滚动 + sticky chip 筛选 + Sheet 详情快开
- **ArchiveQueue** [/queue](../../webui/src/pages/ArchiveQueuePage.tsx):ProgressRing + Tabs + DataTable + SSE 实时进度 + 行展开
- **Sources** [/sources](../../webui/src/pages/SourcesPage.tsx):双栏 + 详情 panel Tabs + 代码拆为 `SourcesList`/`SourceDetailPanel`/`SourceTweetsTab`/`SourceScanHistoryTab` 四 component + 三 hook

**用户可感**:

- 主流程页面完全焕新,与 Dashboard 视觉语言统一

**M2 验收清单**:

1. ☐ Library 万级媒体滚动 60fps(Chrome DevTools Performance,5s 录制 FPS ≥ 55)
2. ☐ `wc -l webui/src/pages/SourcesPage.tsx` ≤ 250
3. ☐ ArchiveQueue 触发任务后,不刷新页面观察 ProgressRing 实时更新
4. ☐ 三页 hover/focus/active 微交互齐全(focus-ring 可见、card hover 升 elevation)
5. ☐ 三页空态/错误态/骨架屏全部新版

### M3 — 收尾五页 + 全局体验 (~5 天) ✨

**主线交付**:

- **Operations**:拆 3 Tab(维护操作 / 系统状态 / 数据库工具),`useMaintenanceOps` + `useSystemHealth` hook 抽离
- **Failures**:错误聚合卡 + DataTable + 行展开堆栈 + 批量重试
- **Duplicates**:双栏对比 + 哈希匹配度可视化条
- **TweetDetail**:60/40 双栏 + 时间线 + 键盘 J/K 翻条 + lightbox
- **CommandPalette** (cmdk):Cmd+K 全局搜索 + 页面跳转 + 命令执行 + 最近搜索
- **i18n 补齐**:zh-CN/en 双语零未翻译键
- **全局键盘快捷键**:`/` 唤起搜索、Cmd+K 命令面板、J/K 翻条、ESC 关闭

**用户可感**: 全站统一视觉语言,Cmd+K 即用。

**M3 验收清单**:

1. ☐ 8 页面无残留旧 `components/ui/` 引用(grep `from "../components/ui"` 应只剩 0 命中)
2. ☐ Operations 拆 3 Tab,各 Tab 独立 component file
3. ☐ CommandPalette 模糊搜索 8 页面,Enter 跳转
4. ☐ Tab/Shift+Tab 键盘导航无死角,所有可交互元素 focus-ring 可见
5. ☐ 切换 zh-CN/en,浏览器控制台无 i18n missing key 警告

### M4 — 后端 P0/P1 收口 (~4 天) 🛠

**主线交付**:

- **Worker lease 持久化**: 在 [archive_run_items](../../sql/) 与 [source_scan_runs](../../sql/) 加 `lease_expires_at TIMESTAMPTZ` + `worker_id TEXT`,worker 启动时回收过期 lease(软心跳,无 Redis)
- **psycopg_pool**: `ConnectionPool(min_size=2, max_size=10)` 接入 [`cli/xarchiver/db.py`](../../cli/xarchiver/db.py)
- **写锁分粒度**: `LockManager.acquire(scope="global"|"source:{id}"|"run:{id}")` 替代 [`api/deps.py`](../../cli/xarchiver/api/deps.py) 中的全局 `write_action_lock`
- **API 契约 CI**: GitHub Action 启后端 dump openapi.json 与 [`webui/src/api/generated.ts`](../../webui/src/api/generated.ts) 比对,不一致 fail
- **DB pool 指标**: 在 Operations 系统状态 Tab 暴露 active/idle 连接数

**用户可感**: 进程崩溃重启不丢任务、Library 缩略图秒开、CI 自动拦截前后端漂移。

**M4 验收清单**:

1. ☐ 启动 worker → `kill -9` 进程 → 重启 → `archive_run_items` 中 `state='running'` 且 `lease_expires_at` 过期的项被重新认领
2. ☐ 改后端 schema 但不重新生成 `generated.ts` → 提 PR → CI fail
3. ☐ Sources 多源并发扫描不互相阻塞(写锁竞争从全局降到 source 粒度)
4. ☐ 4K 视频 `<video>` 标签播放支持边播边加载(206 Partial Content)
5. ☐ Operations 页 DB pool 卡片显示 active/idle 连接数

---

## 五、Skill 联动落地步骤

用户指定要使用 `/frontend-design` 与 `/web-artifacts-builder` 两个 skill,此处明确分工。

| Skill | 何时调用 | 产出 | 阶段 |
|---|---|---|---|
| `/web-artifacts-builder` | M1 早期 | claude.ai 上的 Design System 全套可交互 preview + Dashboard 完整可点击 HTML 原型(用户能直接试主题切换/hover/暗色) | M1 |
| `/frontend-design` | M1 末 / M2 / M3 | 关键页面的高保真 React + Tailwind 代码(Dashboard / Sources / Library),作为视觉锚点 | M1/M2/M3 |

**先做原型再落地的页面**:

- **Dashboard** — 定调子,M1 必须先出原型
- **Sources** — 754 行重灾,先验证拆分模式
- **Library** — 虚拟滚动 + 缩略图 hover overlay 交互需先验

其他 5 页可基于这三个的成熟模式直接落地,不必每页都先做原型。

---

## 六、后端架构优化清单 (克制版 P0/P1)

| 优先级 | 项 | 现状 | 方案 | 工作量 | 阻塞 WebUI? |
|---|---|---|---|---|---|
| **P0** | Worker 状态持久化 | daemon 线程崩溃丢运行中状态 | DB 加 `lease_expires_at` + `worker_id`,启动时回收过期 lease | M | 否 |
| **P0** | API 契约 CI 校验 | 手动 `generate:api-types`,易漂移 | GitHub Action 比对 openapi.json 与 generated.ts | S | 否(建议同 M1) |
| **P1** | DB 连接池 | psycopg 直连无池 | `psycopg_pool.ConnectionPool(2,10)` | S | 否 |
| **P1** | 写锁分粒度 | 全局 `write_action_lock` | `LockManager.acquire(scope=...)` | M | 否 |
| **P1** | 媒体代理流式 | 缩略图代理疑似全量加载 | `StreamingResponse` + `iter_bytes` + Range | S | **是** (Library 需要) |

**明确不做**:

- ❌ Redis / RQ / arq / Celery — 单用户本地工具用不上
- ❌ pgbouncer — psycopg_pool 已够
- ❌ 消息队列 / 分布式锁 — 当前规模用不上
- ❌ 企业级速率限制与审计 — 只在 middleware 留 hook 位

---

## 七、风险与回滚

| 风险 | 应对 |
|---|---|
| shadcn 接入后与现有自建组件混搭丑陋期 | `ui/` 隔离;每 PR 只动一页,可独立 revert |
| 白蓝亮色被部分用户拒绝 | 默认跟随系统;暗色按等同质量打磨;首次启动主题选择 |
| Worker lease 实现 bug 导致任务被重复执行 | DB 加 `claimed_at` 单调约束 + partial unique index `WHERE state='running'`;改造期双跑灰度一周 |
| 虚拟滚动在缩略图加载下白屏抖动 | 用 `react-virtuoso`(对不定高度更友好);缩略图统一 aspect-ratio + blur-up 占位 |
| Recharts 体积膨胀首屏 | 按需 import + Vite 代码分割,Dashboard 独立 chunk;> 100KB 改 uPlot |

---

## 八、与 Phase 3.4 的衔接

[phase-3.4-plan.md](./phase-3.4-plan.md) 已交付的能力是 Phase 4 的前置依赖:

- **结构化业务日志** → Phase 4 Failures 页面的"错误聚合卡"直接消费
- **API v1 响应模型收口** → ui 的 DataTable 列定义直接绑 generated.ts 类型
- **SSE 事件流** → Phase 4 `useEventStream(topic)` 单一长连接 hook 的服务端基础
- **Operations 系统状态面板** → Phase 4 Operations 重构在此基础上拆 Tab + 加可视化

Phase 4 不会推翻 Phase 3.4 的任何 API 设计,只在前端表达层与后端可靠性层做增量。

---

## 九、文档落地清单

本计划落地为三份正式文档(本文件 + 两份子文档),均位于 [docs/design/](.):

| 文档 | 角色 | 主要读者 |
|---|---|---|
| [phase-4-ui-revamp-plan.md](./phase-4-ui-revamp-plan.md) (本文件) | 总纲、决策、4 个 milestone、风险 | PM / 评审 / 实施人首先看这份 |
| [design-system-tokens.md](./design-system-tokens.md) | Design system 完整规范(颜色/字体/间距/elevation/motion) | 前端实施 / 视觉验收 |
| [webui-component-inventory.md](./webui-component-inventory.md) | ui 组件清单 + 旧→新迁移映射 + 8 页面组件使用指南 | 前端实施 / 重构期对照表 |

---

## 十、关键文件索引

- 全局样式: [`webui/src/styles.css`](../../webui/src/styles.css), [`webui/tailwind.config.js`](../../webui/tailwind.config.js)
- 主入口/路由: [`webui/src/main.tsx`](../../webui/src/main.tsx)
- 布局: [`webui/src/components/layout/AppLayout.tsx`](../../webui/src/components/layout/AppLayout.tsx)
- 旧 UI 组件: [`webui/src/components/ui/`](../../webui/src/components/ui/)
- 8 个页面: [`webui/src/pages/`](../../webui/src/pages/)
- API 客户端: [`webui/src/lib/api.ts`](../../webui/src/lib/api.ts), [`webui/src/api/generated.ts`](../../webui/src/api/generated.ts)
- 后端 DB: [`cli/xarchiver/db.py`](../../cli/xarchiver/db.py)
- 后端 worker: [`cli/xarchiver/api/app.py`](../../cli/xarchiver/api/app.py), [`cli/xarchiver/api/deps.py`](../../cli/xarchiver/api/deps.py)
- 后端 services: [`cli/xarchiver/services/`](../../cli/xarchiver/services/)
- DB 迁移: [`sql/`](../../sql/)
- 前置设计: [`phase-3.4-plan.md`](./phase-3.4-plan.md), [`x-media-archiver-v2-design.md`](./x-media-archiver-v2-design.md)
