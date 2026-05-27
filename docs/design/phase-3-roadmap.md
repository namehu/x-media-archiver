# x-media-archiver 升级迭代设计方案（P3）

## Context

P2.0–P2.8.0 已交付稳定的"数据库队列 + 三层架构（CLI / FastAPI / WebUI）"，[AGENTS.md](AGENTS.md) 把核心约束（author_id 路径、显式维护动作、写操作串行化、不提供媒体删除）固化下来。当前框架本身**方向正确**，但在三处出现摩擦：

1. **后端 API 层** — 所有路由集中在 [cli/xarchiver/api/app.py](cli/xarchiver/api/app.py)（383 行单文件、无版本前缀、无统一异常模型），随 P2.7/P2.8 的 endpoint 数量翻倍，已经接近"上帝模块"边界；错误分类硬编码在 [downloader.py:368-387](cli/xarchiver/downloader.py#L368-L387)，跨模块没有集中枚举。
2. **WebUI** — 仅 5 个手写组件，无 Dialog/Toast/DataTable/Confirm；手写 fetch 无重试/超时/类型生成；3s 全局轮询；英文 locale 文件为空；OperationsPage 的 full backfill / full verify **缺二次确认**（违反 [AGENTS.md L90](AGENTS.md#L90)）。
3. **工程基建** — 无 CI、无 lint/format（仅 ruff 配置存在）、无 pre-commit、无 OpenAPI 类型同步、无 E2E。

**P3 目标**：用渐进式迭代（每个子任务独立可上线）补齐这三层的工程化短板，让框架能稳定承载 P2.8 之后的"来源扫描 worker、插件直接投递、备份恢复、可观测性增强"。

---

## 一、当前框架评估结论

### 后端：分层正确，但缺"边界设施"

- ✅ services/ 复用良好，CLI 与 API 无重复业务逻辑（[cli/xarchiver/services/](cli/xarchiver/services/)）
- ✅ 数据库队列 + 进程内锁 + Postgres advisory lock 满足单进程单写的初衷
- ✅ SQL 迁移有 SHA256 校验和保护（[cli/xarchiver/migrations.py:26-38](cli/xarchiver/migrations.py#L26-L38)）
- ⚠️ [api/app.py](cli/xarchiver/api/app.py) 单文件 383 行，路由、Pydantic 模型、worker 线程、锁、路径校验全部混居
- ⚠️ 错误分类字符串散布于 downloader.py / SQL CHECK / WebUI badge 三处，无单一真源
- ⚠️ 无 logging（仅 print）、无自定义异常基类、无 request id
- ⚠️ `recovery.py` / `search.py` / `archive.py` 缺单测

### WebUI：技术栈现代但"没长大"

- ✅ React 19 + Vite 6 + React Query 5 + Tailwind 3 + i18n Context 的脚手架方向正确
- ❌ 组件层贫血：Dialog、Toast、Table、Pagination、Confirm、Skeleton、ErrorBoundary 全缺
- ❌ [api.ts:69-87](webui/src/lib/api.ts#L69-L87) 手写 fetch，无超时/重试/拦截器；类型与后端 Pydantic 手工对齐
- ❌ 全局 `refetchInterval: 3000`（[ArchiveQueuePage.tsx](webui/src/pages/ArchiveQueuePage.tsx)），即使页面静止也轮询
- ❌ 无分页 / 无虚拟滚动；FailuresPage、DuplicatesPage 可能加载数千条
- ❌ [locales/en.ts](webui/src/locales/en.ts) 是空文件，违反 AGENTS.md "维护中英文 locale" 约束
- ❌ OperationsPage 的 full backfill / full verify 只在 API 层用 `confirm_full_scan` 守护，UI 层无二次确认弹窗
- ❌ AppLayout 仅顶部导航，无侧边栏/面包屑/通知中心；7 个一级菜单平铺，已临近横向溢出

### 工程基建：基础未铺

- 无 `.github/workflows`，无 pre-commit，WebUI/Extension 无 ESLint/Prettier
- Python 无 mypy / pyright；FastAPI `/openapi.json` 未对外暴露给 WebUI 类型生成

**结论**：框架不需要推倒，需要"加边界 + 补设施"。下方按 P3.0 → P3.6 渐进式落地。

---

## 二、整体架构目标

```
              ┌──────────────────────────────────────────┐
              │  WebUI (Vite + React 19 + shadcn/ui)     │
              │  - openapi-ts 自动类型同步               │
              │  - SSE 推送（轮询降级）                  │
              │  - i18n zh/en 双语完整                   │
              └──────────────┬───────────────────────────┘
                             │ /api/v1/*  /api/events
              ┌──────────────▼───────────────────────────┐
              │  FastAPI (api/v1/*.py 按域拆路由)        │
              │  - Pydantic schemas 集中在 api/schemas/  │
              │  - 错误码 enum + 统一异常处理器          │
              │  - SSE broker（来自 services 的事件总线）│
              │  - structlog + request_id 中间件         │
              └──────────────┬───────────────────────────┘
                             │
              ┌──────────────▼───────────────────────────┐
              │  services/ + core/  (不变)               │
              │  + core/errors.py  统一错误分类枚举      │
              │  + core/events.py  发布订阅              │
              └──────────────────────────────────────────┘
```

---

## 三、后端调整设计

### 3.1 路由模块化（P3.0）

将 [cli/xarchiver/api/app.py](cli/xarchiver/api/app.py) 按业务域拆分为 APIRouter，路径前缀升级到 `/api/v1`：

```
cli/xarchiver/api/
├── app.py                # create_app + lifespan + middleware（瘦身到 ~80 行）
├── deps.py               # get_settings / get_write_lock 依赖
├── middleware.py         # request_id、structlog 绑定、统一异常
├── schemas/              # 拆分 Pydantic 模型（按域）
│   ├── archive.py        # ArchiveRecord / ArchiveSubmitRequest
│   ├── source.py         # Source* 系列
│   ├── action.py         # Verify/Backfill/Requeue/Export/Recover
│   └── common.py         # 错误响应、分页响应
└── routers/
    ├── health.py         # /health
    ├── library.py        # /api/v1/summary, /media, /tweets/{id}, /duplicates, /failures
    ├── archive_runs.py   # /api/v1/archive-runs/*
    ├── sources.py        # /api/v1/sources/*
    ├── actions.py        # /api/v1/actions/*
    ├── maintenance.py    # /api/v1/maintenance/*
    ├── media_files.py    # /api/v1/media-file/{path}
    └── events.py         # /api/v1/events  (SSE)
```

**保留 `/api/*` 旧路径** 作为 v1 的 alias，整个 P3 不破坏旧 WebUI；P3.6 时移除。

### 3.2 错误分类与异常模型（P3.0 同步）

新建 [cli/xarchiver/core/errors.py](cli/xarchiver/core/errors.py)（**单一真源**）：

```python
class ErrorCategory(StrEnum):
    INVALID_URL = "invalid_url"
    DOWNLOAD_NO_OUTPUT = "download_no_output"
    AUTH_REQUIRED = "auth_required"
    RATE_LIMITED = "rate_limited"
    NETWORK_ERROR = "network_error"
    UNSUPPORTED_MEDIA = "unsupported_media"
    UNKNOWN = "unknown"

class ArchiverError(Exception):
    code: str            # snake_case，对应 HTTPException detail
    http_status: int
    category: ErrorCategory | None
```

- 替换 [downloader.py:368-387](cli/xarchiver/downloader.py#L368-L387) 中硬编码字符串
- WebUI 通过 OpenAPI 自动获得同名 enum
- 在 routers 层统一 `@app.exception_handler(ArchiverError)` 转换
- [docs/downloader-contract.md](docs/downloader-contract.md) 中的错误码表改为引用 enum 源文件

### 3.3 事件总线 + SSE（P3.3）

**最小侵入**方案：在 `services/queue.py` 关键状态转移点（run 状态变更、item 完成、worker 锁状态）发布事件，由 SSE router 订阅广播。

```
core/events.py  →  Broker（内存 asyncio.Queue per subscriber）
services/queue.py 内现有的 process_next_queued_run / submit_archive_batch 增加 publish()
api/routers/events.py 暴露 GET /api/v1/events?topics=run,worker  → text/event-stream
```

WebUI 端 `EventSource` 订阅 `run.updated`、`worker.lock`、`source.scan` 三个 topic，`onerror` 自动降级到 React Query 的现有轮询（保留 3s 作为兜底）。

### 3.4 OpenAPI 暴露与开发流（P3.0）

- FastAPI 已自动生成 `/openapi.json`，**只需**在 [vite.config.ts](webui/vite.config.ts) 代理 `/openapi.json`
- 新增 `webui/scripts/sync-types.ts` 用 `openapi-typescript` 把 schema 输出到 `webui/src/api/generated.ts`
- `npm run typecheck` 之前先 `npm run sync-types`，CI 校验生成结果与提交一致

### 3.5 日志与可观测（P3.4）

- 引入 `structlog`，在 middleware 生成 request_id 并贯穿 service 层
- service 中所有 print 改为 logger
- 新增 `/api/v1/health/detail` 返回：worker 状态、最后 N 条日志、当前锁占用者

### 3.6 测试补齐（贯穿 P3）

补齐 [cli/tests/](cli/tests/) 中 `recovery.py` / `search.py` / `archive.py` 单测；新增 `tests/api/` 用 `httpx.AsyncClient` 跑路由层冒烟（含 SSE 订阅）。

---

## 四、WebUI 重构设计

### 4.1 目录结构（P3.1 落地）

```
webui/src/
├── api/
│   ├── generated.ts            # openapi-typescript 产物（git 提交）
│   ├── client.ts               # fetch 封装：超时、重试、错误统一、request_id 透传
│   ├── queries/                # React Query hooks 按域拆
│   │   ├── useSummary.ts
│   │   ├── useArchiveRuns.ts
│   │   ├── useSources.ts
│   │   └── useTweetDetail.ts
│   └── events.ts               # EventSource 订阅 + 轮询降级
├── components/
│   ├── ui/                     # shadcn 复制项：button/card/badge/input/select 重写为 Radix 版
│   │                            # + dialog/alert-dialog/toast/dropdown/tabs/tooltip/skeleton
│   ├── data/                   # DataTable / Pagination / EmptyState / ErrorState
│   ├── layout/
│   │   ├── AppShell.tsx        # 取代 AppLayout：侧栏 + 顶栏 + 通知区
│   │   ├── PageHeader.tsx      # 标题 + 面包屑 + 主操作位
│   │   └── ConfirmDialog.tsx   # 危险操作双确认（输入 "FULL SCAN" 才能解锁）
│   └── domain/                 # 业务组件（RunStatusBadge、TweetMediaGrid 等）
├── features/                   # 按业务域聚合页面 + 局部组件
│   ├── dashboard/
│   ├── archive-queue/
│   ├── library/
│   ├── sources/
│   ├── operations/
│   ├── failures/
│   ├── duplicates/
│   └── tweet-detail/
├── lib/
│   ├── i18n.tsx                # 保留，扩展 locale 切换 UI
│   ├── format.ts               # formatBytes / formatDateTime / pluralize
│   └── theme.ts                # CSS 变量 + light/dark
└── locales/
    ├── zh.ts
    └── en.ts                   # 必须补齐
```

`pages/` 整体迁入 `features/<domain>/<X>Page.tsx`，路由表保持稳定。

### 4.2 信息架构与导航（P3.1）

`AppLayout` 升级为 **AppShell**：

- 左侧侧栏分组：
  - **运行**：Dashboard / Archive Queue / Sources
  - **数据**：Library / Failures / Duplicates
  - **维护**：Operations
- 顶栏：当前页 PageHeader（面包屑 + 主操作位）+ 全局通知 Toast 区 + locale 切换 + worker 状态指示灯（绿色 idle / 黄色 running / 红色 stuck）
- 移动端：侧栏折叠为汉堡菜单

### 4.3 关键交互补完（P3.2）

- **危险动作双确认**：[OperationsPage](webui/src/pages/OperationsPage.tsx) 的 full backfill / full verify 必须打开 ConfirmDialog，要求用户输入 `FULL SCAN` 才能 enable 提交按钮，前端 + 后端 `confirm_full_scan` 双锁
- **Toast 系统**：所有 mutation 成功 / 失败用 toast 替代 alert / 文本字段
- **DataTable 通用化**：支持分页（offset/limit）、排序、列控制；Failures、Duplicates、Library、ArchiveRuns 共用一份
- **空态 / 错误态**：统一 `<EmptyState icon copy action />` / `<ErrorState onRetry />`，替换页面里的字符串

### 4.4 实时性（P3.3）

- 新增 `useServerEvents(topics)` hook，内部维护 EventSource
- 收到事件 → `queryClient.invalidateQueries(...)` 精准刷新
- React Query `refetchInterval` 由 3s 全局降级为：仅在 SSE 失联超过 10s 时启用 5s 轮询
- WebUI 顶栏出现 `worker_idle` / `worker_running` / `events_offline` 状态条

### 4.5 设计令牌与主题（P3.1）

- 把现有 HSL 颜色变量提升为完整 design token：`--color-bg`、`--color-surface`、`--color-border`、`--color-fg`、`--color-fg-muted`、`--color-primary` 等
- Tailwind 配置改为读取 CSS 变量，新增 `dark:` 预设
- 顶栏开关切换 light / dark / auto，写入 localStorage
- 不引入额外字体，保留 Inter

### 4.6 国际化（P3.1）

- 补齐 [locales/en.ts](webui/src/locales/en.ts)
- locale key 全量审计，统一命名空间（`common.*` / `nav.*` / `<feature>.*`）
- 顶栏增加 `LanguageSwitcher`；首次访问按 `navigator.language` 探测
- AGENTS.md 约束写入 [docs/](docs/)：新增/修改文案必须中英同步

### 4.7 工程化（P3.0）

- 加 ESLint（`eslint-config-prettier` + `@typescript-eslint` + `eslint-plugin-react-hooks`）+ Prettier
- 新增 `npm run lint` / `npm run sync-types` / `npm run check`（lint + typecheck + build）
- pre-commit：ruff + eslint + prettier 仅在改动文件上跑
- GitHub Actions：Python unittest / WebUI check / Extension typecheck 三个 job

---

## 五、迭代里程碑（渐进式 P3.0 → P3.6）

| 里程碑 | 名称 | 关键产出 | 风险 / 兼容性 |
| --- | --- | --- | --- |
| **P3.0** | 工程基建 + API 模块化 | routers 拆分到 `api/routers/`、`/api/v1/*` 双挂、`core/errors.py` 错误枚举、OpenAPI 暴露 + openapi-typescript 同步、structlog + request_id、ESLint/Prettier、pre-commit、GitHub Actions | 旧 `/api/*` 保留 alias；WebUI 仍用旧 client，类型先生成不替换 |
| **P3.1** | WebUI 骨架重构 | shadcn 基础组件落地（button/card/dialog/toast/alert-dialog/dropdown/tabs/tooltip/skeleton）、AppShell 信息架构升级、design token + dark mode、locales/en 补齐 + LanguageSwitcher | 页面逐个迁入 features/，pages/ 与 features/ 短暂共存 |
| **P3.2** | 危险操作 + 数据展示 | ConfirmDialog（FULL SCAN 输入解锁）、DataTable / Pagination 通用组件、EmptyState / ErrorState、Failures/Duplicates/Library 接入分页 | API 层补 `offset`/`total_count` 字段（向前兼容） |
| **P3.3** | 实时性 | `core/events.py` 事件总线、`/api/v1/events` SSE、WebUI `useServerEvents`、worker 状态指示灯 | 失联自动降级到现有 3s 轮询，确保零退化 |
| **P3.4** | 可观测性 | 结构化日志、`/api/v1/health/detail`、Operations 页接入实时日志尾巴、错误分类视图 | 仅追加，不修改既有行为 |
| **P3.5** | 测试与文档 | recovery/search/archive 单测、API 路由层冒烟、Playwright e2e 覆盖 Archive Queue 主流程、`docs/api/` 用 redoc 渲染 OpenAPI | — |
| **P3.6** | 收口 | 移除 `/api/*` 旧 alias、移除 `webui/src/pages/` 旧目录、移除轮询兜底里的过期分支、`docs/design/phase-3-roadmap.md` 终稿 | 唯一一次破坏性变更，集中在此里程碑 |

每个里程碑独立 PR，独立可上线，可随时叫停。

---

## 六、关键文件参考

**后端**
- 路由拆分起点：[cli/xarchiver/api/app.py](cli/xarchiver/api/app.py)
- 错误分类源头：[cli/xarchiver/downloader.py:368-387](cli/xarchiver/downloader.py#L368-L387) → 新建 `cli/xarchiver/core/errors.py`
- 队列与状态机：[cli/xarchiver/services/queue.py](cli/xarchiver/services/queue.py)
- 锁与 worker：[cli/xarchiver/api/app.py:36-37, 344-367](cli/xarchiver/api/app.py#L36-L37)
- 迁移机制：[cli/xarchiver/migrations.py:26-38](cli/xarchiver/migrations.py#L26-L38)

**WebUI**
- API 客户端：[webui/src/lib/api.ts](webui/src/lib/api.ts) → 拆为 `webui/src/api/{client,generated,queries}.ts`
- 布局：[webui/src/components/layout/AppLayout.tsx](webui/src/components/layout/AppLayout.tsx) → `AppShell`
- 危险操作页：[webui/src/pages/OperationsPage.tsx](webui/src/pages/OperationsPage.tsx)
- i18n：[webui/src/lib/i18n.tsx](webui/src/lib/i18n.tsx)、[webui/src/locales/en.ts](webui/src/locales/en.ts)（空文件）
- 配置：[webui/tailwind.config.js](webui/tailwind.config.js)、[webui/vite.config.ts](webui/vite.config.ts)、[webui/package.json](webui/package.json)

**约束与文档**
- 项目约束：[AGENTS.md](AGENTS.md)
- 路线图：[docs/design/phase-2-roadmap.md](docs/design/phase-2-roadmap.md) → 新建 `docs/design/phase-3-roadmap.md`
- 下载器契约：[docs/downloader-contract.md](docs/downloader-contract.md)

---

## 七、验证方法

每个里程碑均需执行：

1. **后端**
   - `docker-compose run --rm --entrypoint python xarchiver -m unittest discover -s /app/tests`
   - `docker-compose run --rm --service-ports xarchiver serve`，curl 旧 `/api/*` 与新 `/api/v1/*` 返回一致
   - P3.3 起：`curl -N http://127.0.0.1:8000/api/v1/events?topics=run` 应在提交 run 时实时收到事件
2. **WebUI**
   - `cd webui && npm run sync-types && npm run check`（typecheck + lint + build）
   - 手动跑桌面 + 窄屏：Dashboard / Archive Queue（提交 → 观察 SSE 推送）/ Operations（验证 FULL SCAN 双确认）/ Sources / Library 分页
   - light / dark / auto 主题切换无样式异常
   - locale 切换为 en 后所有页面无 `nav.*` 类未翻译键
3. **端到端**
   - P3.5 起：Playwright 跑 Archive Queue 主流程（粘贴 URL → 预览 → 提交 → 看到状态从 queued 流转到 verified）
   - 旧 WebUI build 在每个 P3.x 中仍可正常运行（直到 P3.6 移除）
4. **CI**
   - GitHub Actions 三个 job 全绿才允许合并
