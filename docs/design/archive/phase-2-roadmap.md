# x-media-archiver Phase 2 Roadmap

> 日期：2026-05-27  
> 状态：P2.0 - P2.8.1 已落地，P2.8.2 原生 cursor 已接入且剩余真实验收待推进<br>
> 阶段目标：在第一阶段已完成的 CLI 归档内核之上，建设本地 WebUI / API 管理后台能力。

---

## 1. 第一阶段归档结论

第一阶段已完成并归档：

```text
docs/design/archive/x-media-archiver-final-design.md
docs/design/archive/roadmap-todo.md
```

第一阶段验收结论：

```text
1. 插件可导出 tweet_urls.txt / tweets.jsonl / scan_stats.json。
2. CLI 可完成 import -> gallery-dl -> yt-dlp fallback -> backfill -> verify -> export。
3. Docker Postgres 开发链路可运行。
4. Supabase 作为生产 metadata Postgres 的设计和文档已具备。
5. 失败分类、requeue、recover-interrupted、retry limit/backoff 已具备。
6. search、duplicates、CSV、failures、HTML gallery 已具备基础查看能力。
7. CLI 测试、extension typecheck、extension build 作为门禁已跑通。
```

第一阶段不再继续增强静态 HTML gallery。它保留为离线验收工具，第二阶段的主要交互形态转向本地 WebUI。

---

## 2. 第二阶段核心原则

```text
1. 不重写下载器，不替换 gallery-dl / yt-dlp。
2. 不重写 CLI，WebUI/API 复用现有 Python 归档内核。
3. 不把媒体文件上传数据库，Postgres 只存 metadata。
4. 不做公网服务，默认只监听 localhost。
5. 不展示、不上传、不返回 cookies 内容。
6. 不做破坏性删除，首版只做查看、触发、重试、重新入队和导出。
```

---

## 3. Phase 2 Milestones

状态标记：

```text
[x] done
[~] in progress
[ ] pending
```

### P2.0 应用服务层整理

目标：把 CLI 已有能力整理成可被 CLI 和 Web API 共同调用的 service 层。

- [x] 建立 `cli/xarchiver/services/` 服务模块边界。
- [x] 抽取 library 查询服务：tweet/media/search/duplicates。
- [x] 抽取 run 执行服务：archive-urls/requeue/verify/export。
- [x] 抽取 failure 查询服务：failures/latest attempts。
- [x] 保持现有 CLI 命令行为不变。
- [x] 为服务层补单元测试。

验收：

```text
docker-compose run --rm --entrypoint python xarchiver -m unittest discover -s /app/tests
```

### P2.1 本地 API MVP

目标：提供 WebUI 可调用的本地 HTTP API。

- [x] 选择并落地 API 框架：FastAPI。
- [x] 新增 `xarchiver serve` 命令。
- [x] Docker Compose 将 API 暴露到宿主机 `127.0.0.1:${API_PORT:-8000}`。
- [x] 实现健康检查：`GET /health`。
- [x] 实现 dashboard 摘要：`GET /api/summary`。
- [x] 实现媒体列表：`GET /api/media`。
- [x] 实现 tweet/detail 查询：`GET /api/tweets/{tweet_id}`。
- [x] 实现失败列表：`GET /api/failures`。
- [x] 实现重复媒体列表：`GET /api/duplicates`。
- [x] 写入型接口本阶段不开放。
- [x] 实现媒体文件只读预览入口：`GET /api/media-file/{relative_path}`。

验收：

```text
1. API 可在 Docker 中启动。
2. 不需要 cookies 即可查询 metadata。
3. API 响应不包含 cookie 文件内容、数据库连接串等敏感信息。
4. CLI 测试继续通过。
```

### P2.2 WebUI MVP

目标：做一个可日常浏览归档内容的本地管理后台。

- [x] 确定前端技术栈：React + TanStack Query + React Router + shadcn/ui 风格组件 + Tailwind。
- [x] 新增 WebUI 目录和构建脚本：`webui/`。
- [x] Dashboard：状态分布、媒体总数、失败数、最近导出。
- [x] Library：图片/视频网格，支持作者、文本、状态、媒体类型筛选。
- [x] Media detail：tweet 文本、作者、发布时间、本地路径、tweet 链接。
- [x] Failures：失败列表、错误分类、最近 attempt。
- [x] Duplicates：重复组查看。
- [x] 页面不提供删除媒体文件功能。

验收：

```text
1. 可浏览当前 5 条 verified 样本。
2. 可按 text=chaos / author=veritasium 查询到结果。
3. 可看到 failures 和 duplicates 空状态。
4. 前端 build 通过。
```

### P2.3 写入型操作

目标：让 WebUI 可以触发安全的维护操作。

- [x] API 支持 `POST /api/actions/verify`。
- [x] API 支持 `POST /api/actions/requeue`。
- [x] API 支持 `POST /api/actions/recover-interrupted`。
- [x] API 支持 `POST /api/actions/export`。
- [x] API 曾支持 `POST /api/runs/archive-urls`，已由 P2.4.2 的 records 提交接口替代。
- [x] 写入型操作串行化，避免并发下载互相覆盖状态。
- [x] 每次操作返回 action summary。
- [x] WebUI 新增 Operations 页面触发写入型操作。

验收：

```text
1. WebUI 能触发 verify 并看到结果。
2. WebUI 能触发 export 并看到导出路径。
3. 并发触发写入操作时只允许一个运行。
```

### P2.4 Inbox 自动归档（已被 P2.4.2 替代）

目标：用户把插件导出的文件放入 inbox 后，系统可自动处理。

- [x] 新增 `archive/inbox/` 目录规范。
- [x] 新增 `inbox_imports` 表记录文件、hash、状态和结果。
- [x] 新增 `archive_runs` 表并将 inbox 处理结果关联到 run。
- [x] 基于文件 SHA-256 做幂等登记。
- [x] API 支持扫描、处理 pending 和单项重试。
- [x] WebUI 展示 inbox 文件处理状态和关联 run。
- [x] 新增持久化定时设置：启停、扫描间隔、最近/下次扫描时间。
- [x] API 服务内运行定时自动扫描/处理，默认关闭。
- [x] 本阶段原型完成后经工程复核，确认文件 Inbox 不作为正式主流程。

### P2.4.1 增量归档与显式全量维护

目标：归档量增长后，日常处理耗时只随本次输入增长，不随全库媒体数量线性增长。

- [x] `archive-urls` 与归档 workflow 仅处理本次输入涉及的 tweet。
- [x] downloader candidate 查询支持 `tweet_ids` scope。
- [x] backfill 仅解析本次下载涉及的 metadata 目录。
- [x] verify 仅读取本次新增或更新的 media 文件。
- [x] 自动 workflow 不再生成全库 CSV；导出由数据库快照手动触发。
- [x] `archive_runs.result` 按 input/download/media/library_snapshot 分区返回。
- [x] 全量 backfill / hash verify 仅通过显式 Maintenance 入口触发。
- [x] WebUI 区分本次增量结果与数据库资料库总量。

验收：

```text
1. 同批次重复 tweet 不会重复下载。
2. 处理结果能关联到 archive run。
3. 失败项能在 WebUI 中查看。
4. 日常处理与显式全量维护不会并发执行。
```

### P2.4.2 数据库归档队列

目标：让 WebUI/API/CLI 通过一致的任务模型提交归档内容，文件只作为客户端输入格式。

- [x] 新增 `archive_run_items` 队列表，并关联 jobs/attempts；待自动重试项同样避免重复入队。
- [x] 提交服务按 tweet 生成 queued / skipped_verified / linked_pending 任务结果。
- [x] API 生命周期内后台 worker 消费数据库队列并执行 scoped pipeline。
- [x] WebUI 以 Archive Queue 替代文件 Inbox，支持粘贴 URL 与浏览器解析 TXT/JSONL。
- [x] CLI TXT/JSONL 命令改为提交队列，执行依赖运行中的 API worker。
- [x] `inbox_imports` 与 scheduler 表仅保留历史兼容，新流程不使用。

### P2.5 队列体系验收增强与 WebUI 可用性补齐

目标：在数据库归档队列成为主流程后，先补齐可观测性、错误分类和中文 WebUI，再评估更大的入口能力。

#### P2.5.1 Queue 可观测性补齐

- [~] Run 列表展示更清晰的状态、时间和任务统计。
- [x] Run detail 展示每条 tweet item 的状态、重试次数、最近/下次尝试时间。
- [x] Run detail 关联展示每条 item 的 download attempts。
- [x] WebUI 自动刷新 Queue 结果，但保持轻量轮询。
- [x] 真实失败样本验收后补充 downloader contract。

#### P2.5.2 真实下载失败分类

- [x] 固定 downloader 错误类别：`invalid_url`、`download_no_output`、`auth_required`、`rate_limited`、`network_error`、`unsupported_media`、`unknown`。
- [x] Queue item 失败原因优先来自最新 download attempt。
- [x] 用真实图片、视频、重复提交、无媒体样本回归。
- [x] 根据真实样本确认基础类别边界；鉴权失败和限流样本后续遇到再补充真实记录。

#### P2.5.3 WebUI 国际化与中文优先

- [x] 新增 WebUI i18n 基础设施。
- [x] 默认语言为中文。
- [x] 英文翻译表暂留空，缺失时回退中文。
- [x] 当前页面可见文案切换为中文。
- [x] 状态、触发来源、错误类别不再直接暴露内部枚举值。

### P2.6 Archive Queue 输入体验增强

目标：降低日常粘贴或上传 URL 文件时的误提交成本。

- [x] 粘贴多行 URL 后在提交前展示解析预览。
- [x] 展示总行数、有效 URL 数、重复 URL 数、无效行数。
- [x] 存在无效行时禁止提交，并列出前几条无效行。
- [x] 重复 URL 不重复提交，并在预览中展示。
- [x] 上传 TXT / JSONL 后由浏览器解析为 URL 文本，再进入同一预览逻辑。

### P2.7 Run 历史筛选

目标：归档批次变多后，仍然可以快速定位失败批次和目标 tweet。

- [x] API 支持按 run status 筛选批次。
- [x] API 支持按 tweet_id 模糊搜索批次。
- [x] API 支持只看包含失败 item 的批次。
- [x] WebUI Archive Queue 增加状态筛选、tweet_id 搜索、只看失败。
- [x] Run 列表中的触发来源显示为中文说明。

#### P2.5.4 插件直接投递预研

目标：评估插件向本地服务直接提交扫描结果的安全模型，不立即强行实现。

- [ ] 设计本地服务配对机制。
- [ ] 设计一次性 token 或本地授权确认。
- [ ] 插件不发送 cookies。
- [ ] 文件导出仍作为 fallback。
- [ ] 明确 CORS 和来源限制。

验收：

```text
形成设计结论后，再决定是否进入实现。
```

---

## 4. Phase 2 当前下一步

当前已完成：

```text
P2.0 service layer
P2.1 read-only local API
P2.2 read-only WebUI MVP
P2.3 serialized write actions
P2.4.1 incremental archive and explicit full-disk maintenance
P2.4.2 database archive queue
P2.5.1/P2.5.2 queue observability and error categories
P2.6 archive queue input preview
P2.7 run history filters
P2.8.0 source collector foundation
P2.8.0 background historical discovery and scan/download separation
```

当前判断：

```text
1. 插件滚动收集不再作为大型博主历史归档主流程。
2. Source Collector 已具备 checkpoint、后台分批扫描、暂停/恢复、扫描与下载分离能力。
3. 当前最大缺口不是新的入口能力，而是后台任务可观测性和真实长链路验收。
4. 在扫描日志与终止判断验收完成前，不把该能力视为可长期无人值守运行。
```

### P2.8 Source Collector

目标：把“几千到上万条 tweet 的来源发现”从浏览器滚动临时采集，升级为可恢复、可审计、可暂停的来源模型。

- [x] 新增 `archive_sources` 扩展字段：状态、cursor/checkpoint、最近发现、计数、错误信息。
- [x] 新增 `source_discovered_tweets`，记录来源与 tweet 的发现关系。
- [x] API 支持来源创建、列表、详情、暂停/恢复。
- [x] API/CLI 支持把某个来源发现到的 tweet URL 批量提交到现有 Archive Queue。
- [x] WebUI 新增 Sources 页面，支持来源登记和手动提交发现结果。
- [x] 验证 gallery-dl 可通过 profile `/timeline` 与 user `/media` 枚举近期 tweet 元数据。
- [x] WebUI/API/CLI 支持小批量扫描来源并只记录发现结果。
- [x] WebUI/API/CLI 支持显式提交未入队发现项，避免扫描与下载请求叠加。
- [x] 下载队列增加每轮 batch size 限制，下载器增加请求/下载随机延迟参数。
- [x] 将枚举器接入 `archive_sources.cursor_state`，支持分页 checkpoint 和恢复。
- [x] 增加来源扫描 worker，按批次发现 tweet，避免一次性大任务；提交下载仍由用户显式触发。
- [~] 为限流、鉴权失败和网络错误补充来源级失败分类；已有分类、自动暂停和持久化执行记录，尚缺真实失败验收。

### P2.8.1 来源扫描可观测性与执行审计

目标：让后台扫描停止增长、等待或失败时，用户可以直接判断原因，而不是只能观察发现数量。

- [x] 新增每批来源扫描执行记录，至少持久化：`source_id`、扫描范围、触发方式（后台/手工/最新补扫）、开始/结束时间、状态、错误类别、错误摘要。
- [x] 每批记录统计：发现 Tweet 数、新增 Tweet 数、已存在 Tweet 数、预估媒体数，以及扫描前后的 cursor。
- [x] 明确并落库执行结果：`running`、`waiting_downloads`、`succeeded`、`completed_empty_batch`、`completed_end_of_source`、`rate_limited`、`auth_required`、`network_error`、`failed`；随机延迟期间的待调度状态继续持久化在来源的 `cursor_state` / `next_scan_at` 中，不计作一次扫描执行。
- [x] 后台 worker 异常不得仅在循环中被吞掉；来源详情必须可看到最近一次失败原因和发生时间。
- [x] WebUI Sources 详情增加“扫描历史”列表，默认展示最近 20 批执行结果。
- [x] WebUI 当前状态明确显示等待原因：等待随机延迟、等待下载队列、限流暂停、认证暂停、扫描完成。
- [x] 增加扫描统计汇总：累计扫描批次数、累计新增 Tweet 数、最近成功扫描时间、最近错误时间。

验收：

```text
1. 来源后台不增长时，不查看容器日志也能从页面判断是等待、暂停、失败还是完成。
2. 单个 range 的输入、输出、cursor 推进与错误均可追踪。
3. API 重启后，历史执行记录和当前调度状态仍可查看。
```

### P2.8.2 枚举语义、终止条件与真实历史扫描验收

目标：在大规模运行前，用真实来源验证 cursor 设计不会漏扫、误判完成或错误统计多媒体 Tweet。

- [~] 已用 `user_media /media` 真实样本确认 `gallery-dl --range` 按媒体项计数并将结论补入 contract；`profile /timeline` 待原生 cursor 接入后验收。
- [x] 验证媒体页一批 `20` 个媒体项可对应少于 `20` 条 Tweet，并修正范围外 metadata 被误落库的问题。
- [ ] 验证结尾判断：不足一批不能误判完成；只有可证明的空批次或 extractor 明确结束信号才完成。
- [x] 验证重复区域行为：最新补扫遇到已知 Tweet 时不推进历史 cursor，也不错误终止历史扫描。
- [~] 验证暂停、恢复、API 重启后的 checkpoint 延续行为；已发现并修正在途批次覆盖停止状态的竞态，待原生 cursor 路径复验。
- [ ] 验证下载队列运行期间来源扫描会等待，不造成扫描与下载请求叠加。
- [ ] 用真实 `rate_limited`、`auth_required` 或可控模拟结果验收自动暂停、错误展示与恢复操作。
- [x] 将历史枚举从数字 `--range` checkpoint 改为持久化并恢复 `gallery-dl` Twitter 原生 continuation cursor。数字范围在真实 `201-220` 批次耗时约 4 分 25 秒，不满足大型来源后台扫描目标。
- [x] 使用 `user_media /media` 真实连续批次验证 native cursor：`1-20` 建立 cursor，`21-40` 使用并更新 cursor；当前来源保持停止，未自动继续请求。

验收记录输出：

```text
docs/source-scanning-acceptance.md
docs/downloader-contract.md（补充 extractor/range 与扫描错误契约）
```

### P2.8.3 受控下载联调验收

目标：来源发现可靠后，验证从发现结果到本地媒体文件的受控下载闭环。

- [ ] 从真实来源选择少量未入队发现项，按 5 - 20 条分批提交下载。
- [ ] 验证扫描不会自动提交下载，只有人工确认后才创建 Archive Queue run。
- [ ] 验证 `QUEUE_BATCH_SIZE` 与下载随机延迟在实际执行中生效。
- [ ] 验证媒体文件使用稳定路径：`archive/media/<author_id>/<tweet_id>/<tweet_id>--p<media_index>.<ext>`。
- [ ] 验证扫描预估媒体数与下载完成后的 `media_assets` 数量差异可解释。
- [ ] 验证下载失败能从来源发现项关联到 Archive Queue run/item/attempt。

### P2.9 后续能力盘点（不阻塞当前大动作）

以下任务已有价值，但优先级低于 P2.8.1 - P2.8.3 的可信运行闭环：

- [ ] Run 列表状态、时间和任务统计的展示收尾（承接 P2.5.1 中的 `[~]` 项）。
- [ ] 来源生命周期管理：归档/隐藏不再关注的来源，以及是否允许安全删除纯 metadata 记录的设计。
- [ ] 历史扫描完成后的“定期最新补扫”调度设计；需先确定频率、限流策略和手工关闭入口。
- [ ] 插件直接投递本地服务的授权/CORS/token 设计；文件导出继续作为 fallback。
- [ ] 在自有 Supabase 项目执行 migration validation，并记录生产 metadata 数据库恢复演练结果。

### P2.8 当前执行顺序

```text
优先级 A（可信运行前必须完成）
  1. P2.8.1 来源扫描执行日志与页面状态可见化（已实现）
  2. P2.8.2a 接入 gallery-dl Twitter 原生 continuation cursor，替换数字 offset 历史扫描（已实现）
  3. P2.8.2b 按新项目空库状态复验 cursor/终止条件/停止恢复
  4. P2.8.3 少量受控下载联调验收

优先级 B（上述闭环稳定后）
  5. 基于验收结论复核 P3 工程化候选计划，不直接全量启动
  6. 定期最新补扫调度
  7. 插件直接投递预研
  8. 来源生命周期与生产部署维护增强

保持不做
  - 扫描自动提交下载
  - 媒体物理删除
  - cookies 自动读取或上传
  - 绕过认证、代理池或反风控能力
```

P3 衔接决策：

```text
docs/design/archive/phase-3-roadmap.md 仅作为后续工程化候选规划。
P2.8.1 - P2.8.3 未完成前，不启动 API/WebUI 大面积重构、SSE 或旧 API 移除。
完成可信运行闭环后，再依据真实痛点优先选择 CI、统一错误模型、必要分页或路由整理。
```

---

## 5. 暂不投入

```text
1. 不继续增强静态 HTML gallery。
2. 不做媒体文件物理删除。
3. 不做公网部署。
4. 不做 Playwright 无人值守扫描。
5. 不做浏览器 cookies 自动读取或上传。
```
