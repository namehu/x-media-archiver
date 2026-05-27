# x-media-archiver Phase 2 Roadmap

> 日期：2026-05-27  
> 状态：P2.0 / P2.1 / P2.2 / P2.3 / P2.4 首版已落地，等待运行验收<br>
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
- [x] API 支持 `POST /api/runs/archive-urls`。
- [x] 写入型操作串行化，避免并发下载互相覆盖状态。
- [x] 每次操作返回 action summary。
- [x] WebUI 新增 Operations 页面触发写入型操作。

验收：

```text
1. WebUI 能触发 verify 并看到结果。
2. WebUI 能触发 export 并看到导出路径。
3. 并发触发写入操作时只允许一个运行。
```

### P2.4 Inbox 自动归档

目标：用户把插件导出的文件放入 inbox 后，系统可自动处理。

- [x] 新增 `archive/inbox/` 目录规范。
- [x] 新增 `inbox_imports` 表记录文件、hash、状态和结果。
- [x] 新增 `archive_runs` 表并将 inbox 处理结果关联到 run。
- [x] 基于文件 SHA-256 做幂等登记。
- [x] API 支持扫描、处理 pending 和单项重试。
- [x] WebUI 展示 inbox 文件处理状态和关联 run。
- [x] 新增持久化定时设置：启停、扫描间隔、最近/下次扫描时间。
- [x] API 服务内运行定时自动扫描/处理，默认关闭。
- [x] Inbox 根目录仅接受新文件，登记后移动至 `registered/` 或 `duplicates/`。

### P2.4.1 增量归档与显式全量维护

目标：归档量增长后，日常处理耗时只随本次输入增长，不随全库媒体数量线性增长。

- [x] `archive-urls` 与 Inbox workflow 仅处理本次输入涉及的 tweet。
- [x] downloader candidate 查询支持 `tweet_ids` scope。
- [x] backfill 仅解析本次下载涉及的 metadata 目录。
- [x] verify 仅读取本次新增或更新的 media 文件。
- [x] 自动 workflow 不再生成全库 CSV；导出由数据库快照手动触发。
- [x] `archive_runs.result` 按 input/download/media/library_snapshot 分区返回。
- [x] 全量 backfill / hash verify 仅通过显式 Maintenance 入口触发。
- [x] WebUI 区分本次增量结果与数据库资料库总量。

验收：

```text
1. 同一个 tweet_urls 文件重复放入 inbox 不会重复处理。
2. 处理结果能关联到 archive run。
3. 失败项能在 WebUI 中查看。
4. 启用定时处理后，API 存活期间按配置间隔处理 pending 文件。
5. 自动处理与手动写入动作不会并发执行。
```

### P2.5 插件直接投递预研

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
P2.4 inbox manual and timed processing
P2.4.1 incremental archive and explicit full-disk maintenance
```

推荐下一步：

```text
1. 用新导出的 TXT 或 JSONL 文件做 Inbox 人工验收。
2. 在实际使用反馈后评估 P2.5 插件直接投递。
3. 不提前加入删除能力。
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
