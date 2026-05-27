# x-media-archiver Phase 2 Roadmap

> 日期：2026-05-27  
> 状态：第二阶段启动规划  
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

- [ ] 建立 `cli/xarchiver/services/` 或等价服务模块边界。
- [ ] 抽取 library 查询服务：tweet/media/search/duplicates。
- [ ] 抽取 run 执行服务：archive-urls/requeue/verify/export。
- [ ] 抽取 failure 查询服务：failures/latest attempts。
- [ ] 保持现有 CLI 命令行为不变。
- [ ] 为服务层补单元测试。

验收：

```text
docker-compose run --rm --entrypoint python xarchiver -m unittest discover -s /app/tests
```

### P2.1 本地 API MVP

目标：提供 WebUI 可调用的本地 HTTP API。

- [ ] 选择并落地 API 框架，优先 FastAPI。
- [ ] 新增 `xarchiver serve` 命令。
- [ ] API 默认绑定 `127.0.0.1`。
- [ ] 实现健康检查：`GET /health`。
- [ ] 实现 dashboard 摘要：`GET /api/summary`。
- [ ] 实现媒体列表：`GET /api/media`。
- [ ] 实现 tweet/detail 查询：`GET /api/tweets/{tweet_id}`。
- [ ] 实现失败列表：`GET /api/failures`。
- [ ] 实现重复媒体列表：`GET /api/duplicates`。
- [ ] 写入型接口先不开放，或只提供明确手动触发接口。

验收：

```text
1. API 可在 Docker 中启动。
2. 不需要 cookies 即可查询 metadata。
3. API 响应不包含 cookie 文件内容、数据库连接串等敏感信息。
4. CLI 测试继续通过。
```

### P2.2 WebUI MVP

目标：做一个可日常浏览归档内容的本地管理后台。

- [ ] 确定前端技术栈。
- [ ] 新增 WebUI 目录和构建脚本。
- [ ] Dashboard：状态分布、媒体总数、失败数、最近导出。
- [ ] Library：图片/视频网格，支持作者、文本、状态、媒体类型筛选。
- [ ] Media detail：tweet 文本、作者、发布时间、本地路径、tweet 链接。
- [ ] Failures：失败列表、错误分类、最近 attempt。
- [ ] Duplicates：重复组查看。
- [ ] 页面不提供删除媒体文件功能。

验收：

```text
1. 可浏览当前 5 条 verified 样本。
2. 可按 text=chaos / author=veritasium 查询到结果。
3. 可看到 failures 和 duplicates 空状态。
4. 前端 build 通过。
```

### P2.3 写入型操作

目标：让 WebUI 可以触发安全的维护操作。

- [ ] API 支持 `POST /api/actions/verify`。
- [ ] API 支持 `POST /api/actions/requeue`。
- [ ] API 支持 `POST /api/actions/recover-interrupted`。
- [ ] API 支持 `POST /api/actions/export`。
- [ ] API 支持 `POST /api/runs/archive-urls`。
- [ ] 写入型操作串行化，避免并发下载互相覆盖状态。
- [ ] 每次操作返回 run summary。

验收：

```text
1. WebUI 能触发 verify 并看到结果。
2. WebUI 能触发 export 并看到导出路径。
3. 并发触发写入操作时只允许一个运行。
```

### P2.4 Inbox 自动归档

目标：用户把插件导出的文件放入 inbox 后，系统可自动处理。

- [ ] 新增 `archive/inbox/` 目录规范。
- [ ] 设计 `inbox_imports` 或等价追踪表。
- [ ] 基于文件 hash 做幂等。
- [ ] API 支持扫描 inbox。
- [ ] WebUI 展示 inbox 文件处理状态。
- [ ] 后续再决定是否做定时任务。

验收：

```text
1. 同一个 tweet_urls 文件重复放入 inbox 不会重复处理。
2. 处理结果能关联到 archive run。
3. 失败项能在 WebUI 中查看。
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

推荐立即执行：

```text
P2.0 应用服务层整理
```

原因：

```text
1. 当前 CLI 逻辑已经可用，但 WebUI/API 不能直接依赖命令行输出。
2. 服务层整理后，CLI 和 API 可以复用同一套查询、归档、失败处理逻辑。
3. 这一步风险低，不需要先决定完整前端技术栈。
4. 能为 P2.1 FastAPI API 打好边界。
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
