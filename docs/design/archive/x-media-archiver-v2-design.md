# x-media-archiver V2 设计文档：本地资料库与自动归档

> 版本：V2 规划稿  
> 日期：2026-05-27  
> 状态：第二阶段启动规划  
> 产品方向：从可执行的本地归档流水线，发展为可日常使用的个人媒体资料库。

关联文档：

- [x-media-archiver-final-design.md](./x-media-archiver-final-design.md)：第一阶段 V0/V1 基础架构与归档链路设计归档。
- [roadmap-todo.md](./roadmap-todo.md)：第一阶段已实现能力与验收清单归档。
- [phase-2-roadmap.md](./phase-2-roadmap.md)：第二阶段执行路线图。
- [downloader-contract.md](../../downloader-contract.md)：下载器实际输出契约。

---

## 1. 设计背景

现有版本已经建立以下可用基础：

```text
Chrome Extension 导出 tweet URL / JSONL
  -> Python CLI 导入、下载、回填、校验、导出
  -> gallery-dl / yt-dlp 负责媒体解析与下载
  -> Postgres 保存元数据和任务状态
  -> Local Archive Storage 保存媒体文件
```

CLI 已具备一键归档流程和静态 HTML gallery 输出能力，但使用体验仍以命令执行和离线导出为主。用户能够完成备份，却还不能方便地在一个持续可用的入口中浏览资料、搜索内容、审阅失败项、重新执行任务和查看长期运行结果。

V2 的目标不是替换现有下载链路，也不是构建新的抓取机制，而是在已有可靠内核上增加本地管理与自动处理能力。

---

## 2. 产品定位

V2 将项目定位为：

> 面向个人使用的、本地优先的 X/Twitter 媒体资料库与归档控制台。

核心体验：

```text
1. 用户通过插件收集自己可访问的 tweet。
2. 归档任务在本地环境中稳定下载、校验并记录结果。
3. 用户通过浏览器中的本地控制台检索、预览和管理归档任务。
4. 系统可处理用户主动提交的 URL 或导出文件解析结果。
```

继续遵守的边界：

```text
1. 仅归档用户有权访问和保存的内容。
2. 不破解 X 内部接口，不绕过登录或访问限制。
3. 不共享 cookies、tokens 或浏览器会话。
4. 不提供代理池、账号轮换或反风控功能。
5. 媒体文件仍保存在本地，不将大文件上传数据库。
```

---

## 3. V2 核心决策

### 3.1 保留 CLI 作为执行内核

现有 Python `Typer` CLI 已覆盖导入、下载、校验、导出和一键归档工作流。V2 不创建另一套 Commander.js CLI，也不重写下载与数据库逻辑。

CLI 在 V2 的职责：

```text
1. 保持可脚本化、可测试、可在 Docker 中执行的归档内核。
2. 为本地服务和计划任务提供同一套应用服务逻辑。
3. 继续作为故障诊断和批量维护的命令入口。
```

### 3.2 新增本地 Web 命令中心

V2 的主要交互形态为在 Docker 环境中运行的本地 Web 服务和浏览器控制台，而不是桌面应用或重型终端 UI。

选择本地 Web 控制台的原因：

```text
1. 图片和视频预览、筛选和任务审阅更适合图形页面。
2. 能直接复用当前 Python、Postgres 和 archive 挂载目录。
3. 不需要提前承担桌面打包、升级和平台分发成本。
4. 后续如需桌面封装，仍可在同一服务接口之上演进。
```

首版技术选型：

```text
Backend API: FastAPI + uvicorn
Frontend: Vite + React
Client state: TanStack Query
Routing: React Router
UI: Tailwind + 本地 shadcn/ui 风格组件
```

目录边界：

```text
cli/
  xarchiver/
    cli.py                 Typer CLI 入口
    api/                   FastAPI 本地 HTTP 入口
    services/              CLI 与 API 共用的应用服务层
    downloader.py          gallery-dl / yt-dlp 调度
    media.py               media_assets 回填
    verifier.py            文件存在性与 hash 校验
    exporter.py            CSV / HTML / failures / duplicates 导出

webui/
  src/
    components/ui/         shadcn 风格基础组件
    components/layout/     WebUI 框架布局
    lib/                   API client、格式化工具
    pages/                 Dashboard / Library / Detail / Failures / Duplicates
```

当前 WebUI 已进入 P2.4.2，提供数据库 Archive Queue、requeue、recover-interrupted、数据库快照 export，以及必须显式确认的 full backfill / full verify 维护操作。下载与维护写入由 API 进程内锁串行化；如果已有写入操作运行，后续请求等待下一轮队列消费或返回 busy。

### 3.3 自动归档以数据库任务队列为核心

V2 的自动归档不自动登录或扫描 X 页面。用户通过 WebUI 提交 URL 或在浏览器端解析插件导出的 TXT/JSONL；CLI 也可读取同类文件。两者均创建数据库 run/items，由本地 API worker 执行。

这样能够首先解决重复手动执行 CLI 的摩擦，同时避免引入 Playwright 会话维护、页面结构变化和无人值守访问风险。

---

## 4. 总体架构

```text
┌────────────────────────────┐
│ Chrome Extension            │
│ - 扫描 X 页面               │
│ - 导出 TXT / JSONL          │
│ - 后续可选直接投递           │
└──────────────┬─────────────┘
               │
       records API / CLI adapter
               │
               ▼
┌────────────────────────────┐
│ Local Web Console           │
│ - Dashboard                 │
│ - Gallery / Search          │
│ - Runs / Failures           │
│ - Archive Queue / Runs      │
└──────────────┬─────────────┘
               │ local HTTP API
               ▼
┌────────────────────────────┐
│ Python Application Service  │
│ - import / archive run      │
│ - retry / requeue / verify  │
│ - exports / queue worker    │
└──────────────┬─────────────┘
               │ reuses
               ▼
┌────────────────────────────┐
│ Existing CLI + Downloaders  │
│ gallery-dl / yt-dlp         │
└───────────┬────────────────┘
            │
     ┌──────┴──────┐
     ▼             ▼
┌──────────┐  ┌──────────────┐
│ Postgres │  │ Local Archive │
└──────────┘  └──────────────┘
```

运行原则：

```text
1. Web 服务与 CLI 复用同一数据库和归档目录。
2. 服务默认只监听本机地址，不作为公网应用部署。
3. 下载、回填、校验等写入型流程通过统一 run 执行和追踪。
4. 同一归档库同一时间只运行一个写入型归档流程。
```

---

## 5. V2 阶段设计

### 5.1 V2.0 可靠执行与查询基础

目的：为可视化操作和定期自动执行建立稳定后端。

计划能力：

```text
1. 恢复被中断的归档任务。
2. 更准确区分 retryable、permanent、authentication 和 rate-limit 失败。
3. 支持配置最大重试次数与退避策略。
4. 支持将 missing / corrupt 资产重新入队。
5. 支持查询任务历史、attempt 结果和失败原因。
6. 将 workflow 逻辑抽取为 CLI 与本地服务共享的应用服务层。
```

说明：第一阶段 `roadmap-todo.md` 已归档；本文定义的是进入本地控制台前必须具备的产品能力，第二阶段执行状态以后以 `phase-2-roadmap.md` 为准。

建议新增 CLI 能力：

```bash
xarchiver search
xarchiver runs
xarchiver requeue
xarchiver resume
xarchiver serve
```

### 5.2 V2.1 本地 Web 命令中心 MVP

目的：让归档内容能够被日常浏览，让执行问题能够在页面内处理。

主要页面：

```text
Dashboard
  - 媒体总量、状态分布、最近运行、待处理失败摘要

Library
  - 图片/视频预览网格
  - 按作者、文本、媒体类型和状态筛选
  - 查看原 tweet 链接与本地媒体

Tweet Detail
  - 推文文本、作者、来源、媒体列表与本地文件信息

Runs
  - 归档运行列表、下载 job 和 attempts 明细
  - 失败类别、日志摘要和导出结果

Failure Queue
  - 查看失败、missing、corrupt 项
  - 重试或重新入队

Operations
  - 导入文件、运行归档、verify、生成 CSV / HTML / failures 导出
```

首版允许的操作：

```text
1. 导入 tweet_urls.txt 和 tweets.jsonl。
2. 触发完整归档 workflow。
3. 对可重试失败项执行 retry。
4. 对 missing / corrupt 资产执行 requeue。
5. 执行 verify 和生成导出文件。
```

首版不允许的操作：

```text
1. 删除媒体文件。
2. 删除 tweet 或数据库记录。
3. 批量清理重复资产。
4. 修改 cookies 或显示敏感内容。
```

### 5.3 V2.2 数据库队列归档

目的：自动处理用户主动采集到的资料，形成低风险的持续归档能力。

工作流：

```text
1. 用户通过浏览器插件扫描并导出 TXT 或 JSONL。
2. WebUI 在浏览器端读取文件并提交 records，或 CLI 从本地文件提交同一 batch。
3. 系统创建 archive run 与逐 tweet task item。
4. API worker 消费数据库 pending/retryable item 并执行增量下载、回填和校验。
5. 控制台展示本次运行摘要与待人工审阅的失败项。
6. 已归档或已排队 tweet 在新批次中保留审计结果，但不重复下载。
```

实施决策：

```text
1. archive_runs 保存提交批次和运行摘要，archive_run_items 保存逐 tweet 队列状态。
2. WebUI 与 CLI 使用同一提交服务；文件只是输入适配器，不作为队列身份。
3. verified tweet 标记 `skipped_verified`；已有待执行或待自动重试任务标记 `linked_pending`。
4. API 存活期间后台 worker 持续消费数据库队列；API 停止后不继续执行。
5. 队列执行与维护操作共享写入锁，同一时间只运行一次磁盘写入流程。
6. 日常 pipeline 仅 backfill/verify 本次 task scope；
   资料库总量由数据库查询返回，不通过全量磁盘扫描计算。
7. 已应用的 inbox_imports / inbox_scheduler_settings 表只保留历史兼容，新流程不访问。
```

控制台配置能力：

```text
1. 粘贴 URL 或选择本地 TXT/JSONL 形成提交批次。
2. 查看最近运行、逐条任务结果和失败摘要。
3. 对失败任务创建新的人工重试批次。
```

通知边界：

```text
1. 首版仅在控制台首页与运行历史中记录结果。
2. 不发送邮件。
3. 不发送 Webhook。
4. 不依赖系统桌面通知。
```

### 5.4 V2.3 插件直接投递

目的：在控制台任务模型稳定后，减少手工移动导出文件的步骤。

计划行为：

```text
1. 插件新增“发送到本地归档”操作。
2. 操作必须由用户在插件界面中显式触发。
3. 控制台接收扫描结果并创建可追踪的 archive run。
4. 原有 TXT / JSONL 导出继续保留，并可由 WebUI 或 CLI 提交。
```

安全要求：

```text
1. 本地服务不接受来自任意网页的无授权任务请求。
2. 插件与本地服务通过本地配对令牌或一次性授权确认连接。
3. 请求体只包含已扫描 tweet 数据，不包含 cookies。
4. 控制台可展示请求来源、导入数量和对应运行记录。
```

---

## 6. API 与数据模型方向

本节描述 V2 所需接口与数据边界，不代表当前数据库或 API 已实现。

### 6.1 本地 API 能力分组

```text
Library API
  - 查询媒体与 tweet
  - 获取详情、状态和本地预览入口

Run API
  - 创建归档运行
  - 查看运行、jobs 和 attempts
  - 查询实时/最近状态

Action API
  - import
  - retry
  - requeue
  - export

Maintenance API
  - full backfill（必须确认全量磁盘扫描）
  - full verify（必须确认全量磁盘扫描）

Queue API
  - 提交 records 创建 archive run
  - 查询 runs/items 与触发失败重试

Extension Handoff API
  - 配对授权
  - 接收用户显式提交的扫描结果
```

### 6.2 计划新增的数据对象

`archive_runs`：

```text
用途：记录一次完整业务流程，而不是单个下载器 invocation。
内容：触发方式、运行状态、开始/结束时间、输入 scope、下载/媒体增量结果、
      数据库资料库快照、失败摘要。
```

`archive_run_items`：

```text
用途：作为逐 tweet 的可审计数据库任务队列。
内容：对应 run、tweet、输入 payload、执行状态、重试状态、关联活动任务和失败信息。
```

既有数据对象的关系：

```text
1. download_jobs / download_attempts 继续记录下载器级别执行。
2. archive_runs 关联其触发的 jobs，使控制台能展示一次完整归档运行。
3. tweets / media_assets 继续作为资料库内容与文件状态的事实来源。
4. cookies 不进入新表，也不通过 API 返回。
```

---

## 7. 安全与运行边界

### 7.1 本地服务

```text
1. 默认只绑定 localhost。
2. 不默认提供公网访问或云端 Web UI。
3. API 对写入型操作进行串行化，避免同时修改归档状态。
4. 页面不暴露数据库连接串、cookie 路径内容或下载器敏感输出。
```

### 7.2 自动归档

```text
1. 自动任务仅处理数据库中 eligible 的 archive_run_items。
2. 认证失败后暂停继续下载并显示需要用户更新 cookies。
3. 计划执行尊重失败分类、重试上限和退避策略。
4. 每次自动运行保留报告与 attempts，方便复盘。
```

### 7.3 插件投递

```text
1. 必须经过用户主动触发。
2. 必须限制到本地已授权服务。
3. 不从页面中提取或传输登录凭据。
4. 文件导入始终作为隔离、可审计的替代流程。
```

---

## 8. 不进入当前 V2 主线的方向

### 8.1 桌面应用

当前不规划桌面端。Docker + 本地浏览器控制台已经能满足个人使用目标，同时避免安装包、自动升级、跨平台文件权限和服务进程管理的额外维护成本。

### 8.2 重型终端 TUI 或新 CLI 框架

终端适合诊断与脚本化操作，不适合作为图片/视频资料库的主要浏览入口。现有 Python CLI 继续迭代即可，不引入另一套命令实现。

### 8.3 Playwright 无人值守扫描

自动登录浏览器并定期枚举 Bookmarks 或账号页面会显著增加会话、安全和页面变化风险。V2 首选用户提交后由数据库任务队列处理，不将无人值守网页扫描列为主线功能。

### 8.4 删除与存储治理

物理删除、重复媒体清理、容量回收与保留策略需要更严格的确认和恢复机制。V2 控制台首版只做非破坏性管理，不承担文件删除。

### 8.5 外部通知

首版结果仅在本地控制台可见。邮件、Webhook 和系统通知涉及额外密钥及宿主系统集成，不作为 V2 初始要求。

---

## 9. 测试与验收标准

### 9.1 可靠性与应用服务

```text
1. 中断的 archive run 可识别并恢复或安全重新入队。
2. 认证失败、限流、永久失败和可重试错误分类清晰可查询。
3. retry_limit 与退避设置能够生效。
4. missing / corrupt 文件能够通过非破坏性操作重新进入处理流程。
5. CLI 原有一键 workflow 继续可用。
```

### 9.2 Web 命令中心

```text
1. 可按作者、tweet 文本、媒体类型和状态检索媒体。
2. 可预览本地图片和视频并打开对应 tweet 链接。
3. 可查看运行、job、attempt 和失败摘要。
4. 可完成导入、增量归档、重试、重新入队和数据库快照 export 操作，并可显式触发全量 backfill/verify 维护。
5. 并发提交写入任务时不会启动冲突的下载流程。
6. 页面和 API 不泄露 cookies 或连接凭据。
```

### 9.3 数据库队列归档

```text
1. URL 输入和浏览器端 TXT/JSONL 解析可提交输入范围内的增量归档流程。
2. 每个提交创建可审计 run，相同 tweet 的重复执行由任务状态幂等控制。
3. 每次运行都保存输入 scope、增量媒体结果、失败信息和数据库资料库快照。
4. 认证失败时能够停止无意义的自动重试并提示用户处理。
```

### 9.4 插件投递

```text
1. 仅用户显式触发后才向本地服务发送数据。
2. 未配对或未授权请求被拒绝。
3. 直接投递与 WebUI/CLI 提交产生等价、可追踪的归档运行。
4. 原有文件导出能力不因投递能力加入而失效。
```

---

## 10. 后续可评估方向

当 V2 主线稳定后，可再评估：

```text
1. 合集、标签和私人备注。
2. sha256 重复媒体识别与存储容量报告。
3. 备份健康度和迁移检查。
4. 针对明确来源的更高级采集能力。
```

这些方向应在实际使用反馈和归档规模增长后再排序，不提前扩大 V2 首版范围。

---

## 11. 本文档的实施状态

本文档用于固定产品方向和后续开发边界。当前实施状态：

```text
1. P2.0 service layer 已落地在 cli/xarchiver/services/。
2. P2.1 本地 FastAPI API 已落地在 cli/xarchiver/api/。
3. P2.2 React WebUI 首版已落地在 webui/。
4. P2.3 非破坏性写入操作已落地在 API 与 WebUI Operations 页面。
5. P2.4 文件 Inbox 原型已被 P2.4.2 数据库队列替代；`002` 中旧表仅兼容历史。
6. P2.4.1 增量归档与显式全量维护已落地：日常流程按 task scope，磁盘全量检查需要人工确认。
7. P2.4.2 使用 `archive_runs` / `archive_run_items` 和 API worker 作为主流程。
8. 新增 `002_inbox_automation.sql`、`003_archive_runs.sql`、`004_archive_queue.sql`、`005_queue_retry_active.sql` 数据库迁移。
9. 当前未修改插件行为，也未开放 WebUI 删除能力。
```
