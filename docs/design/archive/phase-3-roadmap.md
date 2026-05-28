# x-media-archiver 升级迭代设计方案（P3）

> 状态：核心 P3 路线已闭环，进入后续硬化与体验增强
> 评审日期：2026-05-27
> 第一阶段收口：2026-05-28，用户已完成完整验证
> 执行原则：P3 子项均需完成；按依赖和风险拆小批次推进，不再作为可选候选互斥处理。

## 评审决策

P3 不是“不新增开发即可完成”的迭代。本文中的 API 路由拆分、统一异常模型、SSE、OpenAPI 类型同步、WebUI 重构、CI 与 E2E 均需要新增开发投入。

P3 已按小批次完成核心路线，不再保留旧 `/api/*` 业务兼容层。当前判断以实际代码状态为准：

1. WebUI 已切到 `/api/v1/*`。
2. FastAPI `app.py` 仅负责 app 装配、错误处理、`/health` 与 `/api/v1/*` router 挂载。
3. 旧 `/api/*` 业务路由已移除；`/health` 作为顶层健康检查保留。
4. OpenAPI JSON 与 WebUI generated types 已基于 v1 路由生成。
5. 用户已完成 12 页完整手工验证，当前功能主链路可进入下一阶段硬化。

P3 不一次性全量建设的历史原因如下：

1. 当时主风险是来源历史扫描尚未完成可追踪与真实长链路验收，而不是 API 文件规模或前端目录组织。
2. 内存 SSE 只能改善实时刷新，不能替代持久化的来源扫描批次审计；API 重启后仍需要查明过去发生过什么。
3. 在真实使用稳定前进行 API 和 WebUI 大面积重构，会增加变更面，却不能直接证明大型来源归档可靠。

P2.8 来源扫描闭环完成后，P3 已按裁剪方式启动。历史门禁如下：

```text
必须先完成
  P2.8.1 来源扫描执行日志与页面状态可见化
  P2.8.2 真实 range/cursor/终止条件验收
  P2.8.3 少量受控下载联调验收

P3 执行方式
  所有子项均要完成
  按依赖顺序推进：先工程边界与可验证性，再 API/数据展示，再实时性与 WebUI 骨架，最后收口破坏性变更
  每一批都必须独立可验证、可回退、可暂停
```

## P3 第一阶段收口

2026-05-28 已按真实使用痛点完成 P3 第一阶段，范围刻意收窄为：

1. ✅ GitHub Actions 基础门禁：后端 Docker unittest、WebUI build、Extension typecheck/build。
2. ✅ 测试隔离约定：CI 先重置测试数据库，不接入真实 cookies，不复用本地探索数据。
3. ✅ 错误模型基础：新增 `cli/xarchiver/core/errors.py`，先集中下载与来源扫描共享的错误分类，并让 API
   注册 `ArchiverError` 统一处理器、共享状态码映射和兼容旧 `detail` 字段的标准错误响应。
4. ✅ 必要分页：`/api/v1/library/media` 与 `/api/v1/library/failures` 支持 `limit`、`offset` 与 `total_count`，WebUI 的
   Library / Failures 页面先接入简单上一页/下一页控制，避免大库一次性加载。

用户已完成完整验证。后续推进不再区分“倾向”或“候选”，只按依赖拆批执行。

## 下一步推进计划

### 当前剩余工作

核心 P3 已闭环，后续不再作为“P3 必须阻塞项”，而作为硬化批次继续推进：

1. `response_model` 收口
   - 第一批已完成：分页响应、重复页响应、下载策略、写操作包装、归档提交结果、Tweet/Source/Run 详情的宽模型。
   - 第二批已完成：Library、Failures、Archive Queue、Sources、Duplicates 的分页 rows 已拆成明确模型；Tweet/Run/Source 详情中的主要嵌套对象已从 `dict[str, Any]` 收紧为 Pydantic response schema，并已同步 OpenAPI TS 类型。
   - 优先级：稳定小响应、分页响应、Archive Queue / Sources 详情、Library 详情。
   - 每批补完后重新生成 OpenAPI types，避免一次性改动过大。
   - 后续只保留少量真实可变载荷为宽模型，例如写操作 `result`、历史 JSONB cursor/raw payload、旧 archive run result 的兼容字段。
2. API client 进一步分层
   - 当前 `webui/src/lib/api.ts` 已是请求集中入口；后续可新增按域 helper，减少页面里散落的 URL 字符串。
   - 不影响现有页面工作时，不急于做大规模搬迁。
3. 可观测性增强
   - 第一批已完成：`/api/v1/health/detail` 返回 worker 写锁、队列积压、来源扫描和最近错误摘要。
   - WebUI 顶栏已接入健康详情，展示写操作、队列、扫描和错误计数。
   - Operations 页面已新增系统状态面板，展示队列积压、最近 run、最近 scan 与最近错误列表。
   - 最近错误已补充定位字段，前端可从 `archive_item` 跳到 Tweet detail，从 `source_scan` 跳到对应 Source detail。
   - `HealthDetailResponse` 已拆成明确子模型，并补充最近错误定位字段单测。
   - 结构化日志基础已完成：API 启动时配置 JSON formatter，request id middleware 生成/透传 `X-Request-ID`，访问日志包含 method/path/status/duration/client/request_id。
   - downloader、Archive Queue worker、Source Scan 已补充带 `details` 字段的结构化业务日志。
   - 后续如需继续增强，再考虑实时日志尾巴或日志查询视图。
4. E2E / 手工验收固化
   - 当前批次已按决策移除 E2E，不作为近期推进项。
   - 手工验收仍保留为轻量交付检查：Archive Queue 主流程、Sources 历史扫描、显式维护动作、SSE 刷新。
   - 详见 [P3 手工验收清单](./p3-manual-acceptance.md)。
5. WebUI 长期体验
   - 第一批已完成：Operations 写操作接入 Toast 成功/失败反馈，结果区从原始 JSON 改为可读摘要，并保留可展开调试详情。
   - 后续继续推进：AppShell、Dialog/Skeleton/EmptyState/ErrorState、危险动作输入确认、主题 token。
   - i18n 中英文补齐继续保持为硬约束。

### P3 第二阶段：列表规模化与任务可操作性

2026-05-28 已完成第二阶段核心范围：

- ✅ `/api/v1/archive-runs`、`/api/v1/sources`、`/api/v1/library/duplicates` 支持分页与筛选，并沿用 `PageResponse` 响应形态。
- ✅ WebUI Archive Queue、Sources、Duplicates 接入分页/筛选；Library、Failures 复用同一分页组件。
- ✅ 新增 `PaginationBar` 与中英文分页文案。
- ⚠️ 来源详情 discovered 与 scan_runs 仍保持“最近记录”展示，后续若真实单来源记录继续膨胀，再拆详情内分页。

目标：大型来源进入归档后，Archive Queue、Sources、Duplicates 等页面不能再依赖一次性加载和固定轮询。

后端分页接口约定：Archive Queue、Sources、Duplicates 均沿用 `PageResponse` 形态，返回
`rows/count/total_count/limit/offset`。`/api/v1/library/duplicates` 额外保留 `duplicate_groups`，表示当前过滤语义下全量重复
SHA 分组数；`total_count` 表示可分页的重复媒体行总数，`rows` 为当前页媒体行。

1. Archive Queue 分页与筛选
   - `/api/v1/archive-runs` 增加 `offset`、`total_count`，保留现有 `limit`、`run_status`、`tweet_id`、`failed_only`。
   - WebUI Archive Queue 增加分页、状态筛选、失败项筛选、按 tweet_id 查询。
   - 运行中批次仍保留自动刷新，但只刷新当前页和选中详情。
2. Sources 分页与筛选
   - `/api/v1/sources` 增加 `offset`、`total_count`，支持 `source_status`、`source_type` 的 UI 筛选。
   - 来源详情的 discovered 列表增加分页或“最近 N 条 + 查看更多”，避免单来源几万条发现记录压垮页面。
   - `source_scan_runs` 历史记录增加分页或按状态筛选。
3. Duplicates 分页
   - `/api/v1/library/duplicates` 拆分为可分页查询，返回 `duplicate_groups` 与当前页 rows。
   - WebUI Duplicates 接入分页，保留当前重复组统计。
4. 通用分页组件
   - 抽出 `PaginationBar` / `PageResponse<T>` 复用，避免 Library、Failures、Archive Queue、Sources 各自写一套。
   - 文案保持 `zh/en` 同步；`en.ts` 已有基础词典，后续新增文案必须同步补齐。

### P3 第三阶段：OpenAPI 类型同步与 API 边界整理

2026-05-28 已完成第三阶段基础范围：

- ✅ Vite dev server 代理 `/openapi.json`。
- ✅ 引入 `openapi-typescript`，OpenAPI JSON 作为本地临时产物生成，Git 只追踪 `webui/src/api/generated.ts`。
- ✅ 新增 `npm run sync-types` 与 `npm run generate:api-types`；前者从已提交 OpenAPI JSON 重建 TS 类型，后者先从 FastAPI app 导出 OpenAPI 再同步类型。
- ✅ 新增 `webui/src/api/client.ts`，`webui/src/lib/api.ts` 保留兼容导出，页面无需大规模迁移。
- ✅ FastAPI request schemas 已从 `cli/xarchiver/api/app.py` 拆到 `cli/xarchiver/api/schemas/`，并用测试确认 OpenAPI 组件名稳定。
- ✅ 第一批 `response_model` 已接入，覆盖分页、下载策略、写操作包装、提交结果和主要详情响应；复杂嵌套字段先保持宽模型。

目标：减少手写类型漂移，开始为后续路由拆分铺路。

1. 暴露并代理 `/openapi.json`
   - FastAPI 已自动提供 OpenAPI；WebUI dev server 需要代理或脚本支持读取。
2. 引入 `openapi-typescript`
   - 新增 `webui/scripts/sync-types.ts` 或等价脚本。
   - 生成 `webui/src/api/generated.ts` 并提交。
   - CI 校验生成类型与提交一致。
3. API client 分层
   - 保留 `webui/src/lib/api.ts` 兼容层。
   - 新建 `webui/src/api/client.ts` 与按域 query/mutation helper。
   - 优先迁移新增页面和分页接口，不一次性改完整 WebUI。
4. API schema 整理
   - Pydantic request/response model 从 `api/app.py` 逐步移到 `api/schemas/`。
   - 路由拆分之前先保证 schema 命名稳定，避免 OpenAPI 频繁变化。

### P3 第四阶段：实时性与可观测性

2026-05-28 已完成第四阶段实时刷新基础范围：

- ✅ 新增 `cli/xarchiver/core/events.py` 内存事件总线，事件只用于 WebUI 刷新提示，不替代数据库审计。
- ✅ 新增 `GET /api/v1/events` SSE endpoint，支持 `topics` 过滤，当前 topic 包含 `archive_runs`、`sources`、`source_scans`。
- ✅ Archive Queue 与 Sources 的关键状态转移点已发布事件。
- ✅ WebUI 新增 `useServerEvents`，在 AppLayout 全局订阅 SSE，并按事件精准 invalidate React Query。
- ✅ Archive Queue / Sources 固定轮询从 3s/5s 拉长到 15s，作为 SSE 离线兜底。
- ✅ `/api/v1/health/detail` 与 WebUI 顶栏状态已完成第一批接入。
   - ✅ 结构化日志基础已接入；worker 锁状态事件仍留在后续可观测性批次。

目标：减少固定轮询，运行状态变化能及时可见，同时保留持久化审计。

1. `core/events.py` 内存事件总线
   - 发布 run、run item、source scan、worker lock 等事件。
   - 事件只用于刷新提示，不作为唯一审计来源。
2. `/api/v1/events` SSE
   - 支持 topic 过滤。
   - 断线自动恢复；WebUI 保留轮询兜底。
3. WebUI `useServerEvents`
   - 收到事件后精准 invalidate React Query。
   - Archive Queue、Sources、Dashboard 先接入。
4. 健康详情与结构化日志
   - `/api/v1/health/detail` 返回 worker 状态、锁状态、最近错误摘要。
   - 后端日志逐步从 print/散落 logger 收敛为统一 logger。

### P3 第五阶段：WebUI 骨架与交互系统

2026-05-28 已完成第一批交互系统增强：

- ✅ Operations 页面 mutation 成功 / 失败接入全局 Toast。
- ✅ Operations 结果区改为结构化摘要，覆盖 requeue、recover、export、verify、backfill 的常见返回字段。
- ✅ 原始响应保留在可展开“调试详情”中，便于排障但不干扰日常使用。

目标：管理后台从“能用页面”升级为长期可维护的操作台。

1. AppShell 信息架构
   - 侧栏分组：运行、数据、维护。
   - 顶栏加入 worker 状态、语言切换、全局反馈。
2. 基础 UI 组件
   - Toast 已接入 Operations 写操作反馈。
   - 后续继续补 Dialog、ConfirmDialog、Tooltip、Skeleton、EmptyState、ErrorState、DataTable。
   - 危险动作统一确认：后端守卫不变，前端增加输入式确认。
3. i18n 收口
   - 补齐 `locales/en.ts`。
   - 新增文案必须中英同步。
4. 主题与设计令牌
   - CSS variables / Tailwind token 化。
   - light / dark / auto 作为可选主题，不影响当前业务功能。

### P3 第六阶段：路由模块化与最终收口

2026-05-28 已完成 P3.6 兼容层移除：

- ✅ WebUI API 调用已切到 `/api/v1/*`。
- ✅ `app.py` 已移除旧 `/api/*` 内联业务路由，仅保留 `/health` 与 `/api/v1/*` router 挂载。
- ✅ 媒体文件 URL 已改为 `/api/v1/media-file/...`。
- ✅ OpenAPI JSON 与 `generated.ts` 已按 v1 路由重新生成。
- ✅ 测试新增旧路由不存在断言，防止兼容层回流。
- Archive Queue 主流程 E2E 已从近期计划中移除；后续只在明确需要自动化验收时重新评估。

目标：拆 API 文件、清理兼容层，并形成稳定的长期结构。

1. API routers 拆分
   - `library`、`archive_runs`、`sources`、`actions`、`maintenance`、`media_files`、`events`。
   - 新路径 `/api/v1/*` 已成为唯一业务 API 路径。
2. 测试补齐
   - API 路由层冒烟。
   - Archive Queue 主流程继续以手工验收为主；E2E 暂不推进。
   - recovery/search/archive 的剩余单测。
3. 兼容层移除
   - 旧 `/api/*` alias 已移除。
   - 这是 P3 内唯一集中破坏性变更，已单独执行并由用户完成手工验证。

## Context

P2.0–P2.8.0 已交付"数据库队列 + 三层架构（CLI / FastAPI / WebUI）"的功能骨架，[AGENTS.md](../../AGENTS.md) 把核心约束（author_id 路径、显式维护动作、写操作串行化、不提供媒体删除）固化下来。当前框架本身**方向正确**，P3 已把 API 边界、分页、SSE、OpenAPI 类型同步和 v1 路由收口完成；剩余工作主要是工程硬化和 WebUI 体验增强。

1. **后端 API 层** — 路由已拆到 `cli/xarchiver/api/v1/`，`app.py` 已瘦身；response model、健康详情、结构化日志基础、worker/downloader/source scan 业务日志和第一批服务层测试已完成。
2. **WebUI** — 分页、SSE 状态和 OpenAPI 类型同步基础已接入；下一步缺口是 Dialog/Toast/DataTable/Skeleton/EmptyState 等长期组件，以及 AppShell 信息架构。
3. **工程基建** — GitHub Actions、测试隔离和 OpenAPI 类型生成已接入；下一步缺口是 lint/pre-commit，以及是否继续扩大服务层测试矩阵的取舍。

**P3 目标**：在 P2.8 的来源扫描可信运行闭环完成后，用渐进式迭代（每个子任务独立可上线）补齐三层工程化短板。

---

## 一、当前框架评估结论

### 后端：分层正确，但缺"边界设施"

- ✅ services/ 复用良好，CLI 与 API 无重复业务逻辑（[cli/xarchiver/services/](../../cli/xarchiver/services/)）
- ✅ 数据库队列 + 进程内锁 + Postgres advisory lock 满足单进程单写的初衷
- ✅ SQL 迁移有 SHA256 校验和保护（[cli/xarchiver/migrations.py](../../cli/xarchiver/migrations.py)）
- ✅ [api/app.py](../../cli/xarchiver/api/app.py) 已瘦身为 app 装配入口，业务路由拆到 `api/v1/`
- ✅ `core/errors.py` 已建立错误分类基础，后续继续收敛 downloader/source/WebUI 中的剩余映射
- ✅ API 层已有结构化 JSON logging / request id
- ✅ `recovery.py` / `search.py` / `archive.py` 已有基础单测或集成测试覆盖；后续仅按风险补增量用例

### WebUI：技术栈现代但"没长大"

- ✅ React 19 + Vite 6 + React Query 5 + Tailwind 3 + i18n Context 的脚手架方向正确
- ⚠️ 组件层仍偏薄：已有分页组件，但 Dialog、Toast、DataTable、Confirm、Skeleton、ErrorBoundary 仍待补
- ✅ [api/client.ts](../../webui/src/api/client.ts) 与 [api/generated.ts](../../webui/src/api/generated.ts) 已建立 OpenAPI 类型同步基础，[lib/api.ts](../../webui/src/lib/api.ts) 作为兼容导出入口保留
- ✅ Archive Queue / Sources 已接入 SSE 精准刷新，固定轮询拉长为离线兜底
- ✅ Library、Failures、Archive Queue、Sources、Duplicates 已接入分页；来源详情内 discovered / scan_runs 后续视数据规模再拆分页
- ✅ [locales/en.ts](../../webui/src/locales/en.ts) 已有基础词典；后续新增文案继续强制中英文同步
- ⚠️ [OperationsPage](../../webui/src/pages/OperationsPage.tsx) 已有显式勾选确认；输入式 ConfirmDialog 属于进一步降低误操作概率的可选增强
- ❌ AppLayout 仅顶部导航，无侧边栏/面包屑/通知中心；7 个一级菜单平铺，已临近横向溢出

### 工程基建：基础未铺

- 已有 `.github/workflows` 基础门禁；pre-commit、WebUI/Extension ESLint/Prettier 仍待后续决策
- Python 暂无 mypy / pyright；FastAPI `/openapi.json` 与 WebUI 类型生成基础已接入

**结论**：框架不需要推倒，P3 已完成主要边界设施建设。后续重点转为 WebUI 长期体验硬化、lint/pre-commit 决策，以及少量按风险补充的后端测试；E2E 暂不作为近期任务。

---

## 二、整体架构目标

```
              ┌──────────────────────────────────────────┐
              │  WebUI (Vite + React 19 + shadcn/ui)     │
              │  - openapi-ts 自动类型同步               │
              │  - SSE 推送（轮询降级）                  │
              │  - i18n zh/en 双语完整                   │
              └──────────────┬───────────────────────────┘
                             │ /api/v1/*
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

将 [cli/xarchiver/api/app.py](../../cli/xarchiver/api/app.py) 按业务域拆分为 APIRouter，路径前缀升级到 `/api/v1`：

```
cli/xarchiver/api/
├── app.py                # create_app + lifespan + middleware（瘦身到 ~80 行）
├── deps.py               # get_settings / get_write_lock 依赖
├── middleware.py         # request_id、structlog 绑定、统一异常（后续可观测性批次）
├── schemas/              # 拆分 Pydantic 模型（按域）
│   ├── requests.py       # 当前 request schemas
│   └── responses.py      # 后续 response_model 收口
└── v1/
    ├── library.py        # /api/v1/library/*
    ├── archive_runs.py   # /api/v1/archive-runs/*
    ├── sources.py        # /api/v1/sources/*
    ├── actions.py        # /api/v1/actions/*
    ├── maintenance.py    # /api/v1/maintenance/*
    └── misc.py           # /api/v1/events, settings, media-file
```

旧 `/api/*` 业务路径已经移除；新增业务能力应只挂到 `/api/v1/*`。

### 3.2 错误分类与异常模型（P3.0 同步）

新建 [cli/xarchiver/core/errors.py](../../cli/xarchiver/core/errors.py)（**单一真源**）：

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

- 已建立 [core/errors.py](../../cli/xarchiver/core/errors.py) 与 API 统一处理基础
- 继续替换 [downloader.py](../../cli/xarchiver/downloader.py) 中剩余硬编码字符串
- 后续通过 response model / OpenAPI 暴露更稳定的错误响应 schema
- [docs/downloader-contract.md](../../downloader-contract.md) 中的错误码表改为引用 enum 源文件

### 3.3 事件总线 + SSE（P3.3）

前置条件：来源扫描批次记录必须已经通过 P2.8.1 持久化落库；SSE 只用于刷新已持久化状态，不能作为扫描执行审计的唯一来源。

已实现最小侵入方案：在 Archive Queue 与 Sources 的关键状态转移点发布事件，由 SSE endpoint 订阅广播。

```
core/events.py  →  Broker（内存 asyncio.Queue per subscriber）
services/queue.py / services/sources.py 发布事件
api/v1/misc.py 暴露 GET /api/v1/events?topics=archive_runs,sources,source_scans  → text/event-stream
```

WebUI 端 `EventSource` 订阅 `archive_runs`、`sources`、`source_scans`、`worker` 等 topic，`onerror` 自动降级到 React Query 的轮询兜底。

### 3.4 OpenAPI 暴露与开发流（P3.0）

- FastAPI 已自动生成 `/openapi.json`，**只需**在 [vite.config.ts](../../webui/vite.config.ts) 代理 `/openapi.json`
- 已新增 `webui/package.json` 中的 `generate:openapi` / `sync-types` / `generate:api-types` 脚本，先生成被忽略的 `webui/.openapi.json`，再用 `openapi-typescript` 输出到 `webui/src/api/generated.ts`
- `npm run generate:api-types` 用于后端 schema 变更后的类型同步

### 3.5 日志与可观测（P3.4）

- API 层已用标准库 logging 输出 JSON 结构化日志，在 middleware 生成 request_id 并通过 `X-Request-ID` 响应头透传
- downloader、archive queue worker、source scan 中的高价值业务事件已补充结构化 `details` 字段
- `/api/v1/health/detail` 已返回：worker 写锁、队列积压、来源扫描状态与最近错误摘要

### 3.6 测试补齐（贯穿 P3）

[cli/tests/](../../cli/tests/) 中 `recovery.py` / `archive.py` 等服务层基础单测已补齐；API 路由层已有冒烟测试，SSE 仍以现有事件总线单测和手工验收为主。

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
├── features/                   # 后续按业务域聚合页面 + 局部组件
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

`pages/` 可在后续体验批次逐步迁入 `features/<domain>/<X>Page.tsx`，路由表保持稳定。

### 4.2 信息架构与导航（P3.1）

`AppLayout` 升级为 **AppShell**：

- 左侧侧栏分组：
  - **运行**：Dashboard / Archive Queue / Sources
  - **数据**：Library / Failures / Duplicates
  - **维护**：Operations
- 顶栏：当前页 PageHeader（面包屑 + 主操作位）+ 全局通知 Toast 区 + locale 切换 + worker 状态指示灯（绿色 idle / 黄色 running / 红色 stuck）
- 移动端：侧栏折叠为汉堡菜单

### 4.3 关键交互补完（P3.2）

- **危险动作确认增强**：[OperationsPage](../../webui/src/pages/OperationsPage.tsx) 当前已有显式勾选确认；若真实使用仍存在误触风险，再增强为输入 `FULL SCAN` 的 ConfirmDialog，并继续保留后端 `confirm_full_scan` 守卫
- **Toast 系统**：所有 mutation 成功 / 失败用 toast 替代 alert / 文本字段
- **DataTable 通用化**：支持分页（offset/limit）、排序、列控制；Failures、Duplicates、Library、ArchiveRuns 共用一份
- **空态 / 错误态**：统一 `<EmptyState icon copy action />` / `<ErrorState onRetry />`，替换页面里的字符串

### 4.4 实时性（P3.3）

- 新增 `useServerEvents(topics)` hook，内部维护 EventSource
- 收到事件 → `queryClient.invalidateQueries(...)` 精准刷新
- 将运行中页面的固定 `refetchInterval` 调整为：仅在 SSE 失联超过 10s 时启用 5s 轮询
- WebUI 顶栏出现 `worker_idle` / `worker_running` / `events_offline` 状态条

### 4.5 设计令牌与主题（P3.1）

- 把现有 HSL 颜色变量提升为完整 design token：`--color-bg`、`--color-surface`、`--color-border`、`--color-fg`、`--color-fg-muted`、`--color-primary` 等
- Tailwind 配置改为读取 CSS 变量，新增 `dark:` 预设
- 顶栏开关切换 light / dark / auto，写入 localStorage
- 不引入额外字体，保留 Inter

### 4.6 国际化（P3.1）

- 补齐 [locales/en.ts](../../webui/src/locales/en.ts)
- locale key 全量审计，统一命名空间（`common.*` / `nav.*` / `<feature>.*`）
- 顶栏增加 `LanguageSwitcher`；首次访问按 `navigator.language` 探测
- AGENTS.md 约束写入 [docs/](../)：新增/修改文案必须中英同步

### 4.7 工程化（P3.0）

- 加 ESLint（`eslint-config-prettier` + `@typescript-eslint` + `eslint-plugin-react-hooks`）+ Prettier
- 新增 `npm run lint` / `npm run sync-types` / `npm run check`（lint + typecheck + build）
- pre-commit：ruff + eslint + prettier 仅在改动文件上跑
- GitHub Actions：Python unittest / WebUI check / Extension typecheck 三个 job

---

## 五、迭代里程碑（渐进式 P3.0 → P3.6）

| 里程碑 | 名称 | 关键产出 | 风险 / 兼容性 |
| --- | --- | --- | --- |
| **P3.0** | 工程基建与错误边界 | ✅ GitHub Actions、测试隔离说明、`core/errors.py`、标准错误响应、WebUI `ApiError`、OpenAPI 类型同步基础 | lint/pre-commit 后续视需要补 |
| **P3.1** | 列表规模化 | ✅ Library/Failures/Archive Queue/Sources/Duplicates 分页与筛选、通用分页组件 | 向前兼容；旧响应字段 `rows/count` 保留 |
| **P3.2** | OpenAPI 与 API 边界 | ✅ OpenAPI 代理、类型生成、API client 分层、request schemas 迁移、主要 response_model 收口 | 少量可变 JSONB/操作结果保留宽模型 |
| **P3.3** | 实时性 | ✅ `core/events.py` 事件总线、`/api/v1/events` SSE、WebUI `useServerEvents`、事件连接状态指示；⏳ worker 锁状态事件后续补 | SSE 只负责刷新；失联降级到 15s 条件轮询，不能丢失历史诊断能力 |
| **P3.4** | 可观测性 | ✅ `/api/v1/health/detail`、WebUI 顶栏健康状态、Operations 系统状态面板、最近错误定位跳转、健康响应模型与定位测试、API JSON 结构化日志/request id、worker/downloader/source scan 业务日志；⏳ 实时日志尾巴、错误分类视图 | 仅追加，不修改既有行为 |
| **P3.5** | WebUI 骨架与交互系统 | AppShell、Dialog/Toast/DataTable/EmptyState/ErrorState、危险操作输入确认、i18n、主题令牌 | 页面逐个迁移，pages/ 与 features/ 可短暂共存 |
| **P3.6** | 路由模块化与最终收口 | ✅ `/api/v1/*` router、WebUI v1 调用、移除旧 `/api/*` 内联兼容层、OpenAPI 重新生成 | 已完成破坏性变更；手动联调需重启 API/WebUI |

P3 已启动。后续每个批次应独立可验证、可上线、可暂停；所有子项都要完成，只按依赖与风险排序。

---

## 六、关键文件参考

**后端**
- 路由拆分起点：[cli/xarchiver/api/app.py](../../cli/xarchiver/api/app.py)
- 错误分类源头：[cli/xarchiver/downloader.py](../../cli/xarchiver/downloader.py) → 新建 `cli/xarchiver/core/errors.py`
- 队列与状态机：[cli/xarchiver/services/queue.py](../../cli/xarchiver/services/queue.py)
- 锁与 worker：[cli/xarchiver/api/app.py](../../cli/xarchiver/api/app.py)
- 迁移机制：[cli/xarchiver/migrations.py](../../cli/xarchiver/migrations.py)

**WebUI**
- API 客户端：[webui/src/lib/api.ts](../../webui/src/lib/api.ts) → 拆为 `webui/src/api/{client,generated,queries}.ts`
- 布局：[webui/src/components/layout/AppLayout.tsx](../../webui/src/components/layout/AppLayout.tsx) → `AppShell`
- 危险操作页：[webui/src/pages/OperationsPage.tsx](../../webui/src/pages/OperationsPage.tsx)
- i18n：[webui/src/lib/i18n.tsx](../../webui/src/lib/i18n.tsx)、[webui/src/locales/en.ts](../../webui/src/locales/en.ts)
- 配置：[webui/tailwind.config.js](../../webui/tailwind.config.js)、[webui/vite.config.ts](../../webui/vite.config.ts)、[webui/package.json](../../webui/package.json)

**约束与文档**
- 项目约束：[AGENTS.md](../../AGENTS.md)
- 路线图：[docs/design/archive/phase-2-roadmap.md](./phase-2-roadmap.md)
- 下载器契约：[docs/downloader-contract.md](../../downloader-contract.md)

---

## 七、验证方法

每个里程碑均需执行：

1. **后端**
   - `docker-compose run --rm --entrypoint python xarchiver -m unittest discover -s /app/tests`
   - `docker-compose run --rm --service-ports xarchiver serve`，确认 `/api/v1/*` 可用，旧 `/api/*` 业务路由不可用
   - P3.3 起：`curl -N http://127.0.0.1:8000/api/v1/events?topics=run` 应在提交 run 时实时收到事件
2. **WebUI**
   - `cd webui && npm run sync-types && npm run check`（typecheck + lint + build）
   - 手动跑桌面 + 窄屏：Dashboard / Archive Queue（提交 → 观察 SSE 推送）/ Operations（验证 FULL SCAN 双确认）/ Sources / Library 分页
   - light / dark / auto 主题切换无样式异常
   - locale 切换为 en 后所有页面无 `nav.*` 类未翻译键
3. **端到端**
   - Archive Queue 主流程暂以手工验收为主（粘贴 URL → 预览 → 提交 → 看到状态从 queued 流转到 verified）；Playwright E2E 当前不推进
   - P3.6 后只验收 v1 WebUI，不再验收旧 `/api/*` 业务兼容层
4. **CI**
   - GitHub Actions 三个 job 全绿才允许合并
