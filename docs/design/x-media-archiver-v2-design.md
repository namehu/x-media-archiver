# x-media-archiver V2 设计文档：本地资料库与自动归档

> 版本：V2 规划稿  
> 日期：2026-05-27  
> 状态：第二阶段启动规划  
> 产品方向：从可执行的本地归档流水线，发展为可日常使用的个人媒体资料库。

关联文档：

- [archive/x-media-archiver-final-design.md](./archive/x-media-archiver-final-design.md)：第一阶段 V0/V1 基础架构与归档链路设计归档。
- [archive/roadmap-todo.md](./archive/roadmap-todo.md)：第一阶段已实现能力与验收清单归档。
- [phase-2-roadmap.md](./phase-2-roadmap.md)：第二阶段执行路线图。
- [downloader-contract.md](../downloader-contract.md)：下载器实际输出契约。

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
4. 系统可定期处理用户主动放入收件箱的导出文件。
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

当前 WebUI 已进入 P2.3，提供非破坏性写入操作：verify、requeue、recover-interrupted、export、archive-urls。写入型操作由 API 进程内锁串行化；如果已有写入操作运行，后续请求返回 busy。

### 3.3 自动归档从导入收件箱开始

V2 的定期自动归档不自动登录或扫描 X 页面。用户仍然主动通过插件扫描并导出，系统自动处理已放入本地收件箱的 TXT/JSONL 文件。

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
      file import / future handoff
               │
               ▼
┌────────────────────────────┐
│ Local Web Console           │
│ - Dashboard                 │
│ - Gallery / Search          │
│ - Runs / Failures           │
│ - Schedule / Inbox          │
└──────────────┬─────────────┘
               │ local HTTP API
               ▼
┌────────────────────────────┐
│ Python Application Service  │
│ - import / archive run      │
│ - retry / requeue / verify  │
│ - exports / scheduling      │
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

说明：第一阶段 `archive/roadmap-todo.md` 已归档；本文定义的是进入本地控制台前必须具备的产品能力，第二阶段执行状态以后以 `phase-2-roadmap.md` 为准。

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

### 5.3 V2.2 导入收件箱与定期自动归档

目的：自动处理用户主动采集到的资料，形成低风险的持续归档能力。

新增目录：

```text
archive/
  inbox/
    tweet_urls_*.txt
    tweets_*.jsonl
```

工作流：

```text
1. 用户通过浏览器插件扫描并导出 TXT 或 JSONL。
2. 用户将文件放入 archive/inbox/。
3. 计划任务发现未处理文件并按文件哈希登记。
4. 系统自动导入、下载、回填、校验和生成导出报告。
5. 控制台展示本次运行摘要与待人工审阅的失败项。
6. 同一导入文件再次出现时不会重复创建归档任务。
```

实施决策：

```text
1. archive/inbox/ 支持 tweet_urls_*.txt 和 tweets_*.jsonl。
2. inbox_imports 按 SHA-256 唯一登记文件内容。
3. archive_runs 记录每次实际处理结果，inbox_imports 关联 archive_run_id。
4. 定时配置持久化保存 enabled 与 interval_minutes，默认 enabled=false。
5. 定时循环运行于本地 API 服务内部；API 停止后不会继续后台归档。
6. 手动处理与定时处理共享写入锁，同一时间只运行一次写入流程。
```

控制台配置能力：

```text
1. 启用或暂停收件箱自动处理。
2. 设置运行频率。
3. 立即执行一次扫描。
4. 查看最近运行、导入文件结果和失败摘要。
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
4. 原有 TXT / JSONL 导出和收件箱路径继续保留作为回退流程。
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
  - verify
  - export

Inbox API
  - 查看已发现和已处理的导入文件
  - 立即扫描收件箱

Schedule API
  - 创建、启用、暂停和更新本地计划
  - 查看计划运行结果

Extension Handoff API
  - 配对授权
  - 接收用户显式提交的扫描结果
```

### 6.2 计划新增的数据对象

`archive_runs`：

```text
用途：记录一次完整业务流程，而不是单个下载器 invocation。
内容：触发方式、运行状态、开始/结束时间、导入数、成功数、失败数、
      verify/export 结果、失败摘要。
```

`inbox_imports`：

```text
用途：保证收件箱导入幂等并可追踪来源。
内容：文件路径、文件哈希、文件类型、发现时间、处理状态、对应 run。
```

`automation_schedules`：

```text
用途：保存本地自动处理配置。
内容：计划类型、启停状态、执行频率、最近运行时间、下次运行时间、
      最近结果。
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
1. 自动任务仅处理本地收件箱文件。
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

自动登录浏览器并定期枚举 Bookmarks 或账号页面会显著增加会话、安全和页面变化风险。V2 首选收件箱自动处理，不将无人值守扫描列为主线功能。

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
4. 可完成导入、归档、重试、重新入队、verify 和 export 操作。
5. 并发提交写入任务时不会启动冲突的下载流程。
6. 页面和 API 不泄露 cookies 或连接凭据。
```

### 9.3 收件箱自动归档

```text
1. 新的 TXT/JSONL 导入文件可以按计划触发完整归档流程。
2. 相同文件不会重复处理或重复创建 run。
3. 每次运行都保存可查看的摘要、失败信息和导出结果。
4. 认证失败时能够停止无意义的自动重试并提示用户处理。
```

### 9.4 插件投递

```text
1. 仅用户显式触发后才向本地服务发送数据。
2. 未配对或未授权请求被拒绝。
3. 直接投递与文件导入产生等价、可追踪的归档运行。
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
5. P2.4 Inbox 手动/定时处理已落地在 `archive/inbox/`、`inbox_imports` 与 `archive_runs`。
6. 新增 `002_inbox_automation.sql` 和 `003_archive_runs.sql` 数据库迁移。
7. 当前未修改插件行为。
8. 当前未开放 WebUI 删除能力。
```
