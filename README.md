# x-media-archiver

本地优先（local-first）的 X/Twitter 媒体归档工具，基于 Docker 化的流水线：

```text
tweet URLs -> scoped download -> scoped media_assets backfill -> scoped verify
```

## 快速开始

构建 CLI 镜像并初始化本地归档目录：

```bash
docker-compose build xarchiver
docker-compose run --rm xarchiver init /app/archive
docker-compose run --rm xarchiver db migrate
```

用于一次性本地验证时，可重置元数据数据库并重新应用所有迁移：

```bash
docker-compose run --rm xarchiver db reset --yes
```

这只会清空 Postgres 元数据，不会删除 `archive/` 下的文件。

把导出的 X/Twitter cookies 放到：

```text
secrets/cookies.txt
```

cookie 文件必须使用 Netscape cookie 格式，并包含 X/Twitter 的 `auth_token` 与 `ct0`。请仅保留在本地；该文件已被 git 忽略。WebUI 的 `Operations -> Cookies` 可在保存后通过 X Bookmarks 最小化请求检测登录状态；检测不会保存 Bookmarks 内容，也不会自动刷新或回写 token。

用每行一个 tweet URL 替换 `examples/tweet_urls.example.txt`：

```text
https://x.com/PhysInHistory/status/2058554692586885322
https://x.com/dpoddolphinpro/status/2059072547585433944
```

类似 `https://x.com/XiangHupt/likes` 的 profile URL 不是合法输入。归档器需要明确的 `/status/<tweet_id>` URL。

导入并查看队列：

```bash
docker-compose run --rm xarchiver import-urls /app/examples/tweet_urls.example.txt
docker-compose run --rm xarchiver status
```

运行真实下载流程：

```bash
docker-compose run --rm xarchiver download --engine gallery-dl
docker-compose run --rm xarchiver retry --engine yt-dlp
docker-compose run --rm xarchiver verify --full
docker-compose run --rm xarchiver export --format csv
```

输出位置：

```text
archive/media/       已下载的媒体与元数据
archive/exports/     CSV 导出
archive/state/       下载器状态与运行时 cookie 副本
```

媒体文件按稳定的路径片段存储：

```text
archive/media/<author_id>/<tweet_id>/<tweet_id>--p<media_index>.<ext>
```

用户名保存在 Postgres 元数据中用于搜索与展示，但不作为文件系统目录名的主键。

从浏览器扩展导出 URL 后，推荐的一条命令式工作流：

```bash
docker-compose run --rm xarchiver archive-urls /app/examples/tweet_urls.example.txt
```

该命令会解析本地文件并提交一个基于数据库的归档 run。`xarchiver serve` 运行时，API worker 会处理队列中的 tweet，使用 scoped 下载、回填与校验操作。需要数据库快照时再单独运行导出命令。

也可通过同一服务提交 JSONL 输入：

```bash
docker-compose run --rm xarchiver archive-jsonl /app/examples/tweets.example.jsonl
```

## Archive Queue

归档提交在 Postgres 中存为 runs 与 per-tweet task items：

```text
WebUI records / CLI file parser
  -> archive_runs + archive_run_items
  -> API background worker
  -> scoped download / backfill / verify
```

首次使用前运行迁移：

```bash
docker-compose run --rm xarchiver db migrate
```

数据库迁移由 Alembic 管理，位于 `cli/xarchiver/alembic/versions` 目录下。当前 schema 从单个基线版本起步，可使用 `xarchiver db downgrade` 进行降级。

后端数据访问刻意保持分层，不使用完整 ORM：

```text
Alembic revisions                  -> 变更与回滚
SQLAlchemy Core query builders      -> 查询与 DML（insert、update、delete、upsert）的默认选择
Pydantic row models                 -> service 边界的类型化 row 校验
Fixed SQL strings                   -> 仅限迁移、advisory lock、难以建模的 Postgres 特性或遗留迁移工作
```

共享 Core 表元数据位于 `cli/xarchiver/tables.py`，编译后的查询使用 `cli/xarchiver/sql_builder.py`，确保 psycopg 接收命名参数。新增数据库读写应使用 SQLAlchemy Core，而非手写 SQL 字符串。若确实无法避免新增固定 SQL 字符串，需在调用处注明原因。

打开 WebUI 的 `Archive Queue` 页面可：

```text
1. 提交一个或多个 tweet URL。
2. 选择本地 TXT 或 JSONL 导出文件，在浏览器侧解析并提交。
3. 查看 runs 与逐条 tweet task 的结果。
4. 将失败项作为新的可审计 run 进行重试。
```

队列行为：

```text
1. 每次提交都会创建一个 archive run，并在该 run 内去重重复的 tweet ID。
2. 已 verified 的 tweets 会标记为 skipped_verified，不进行磁盘 I/O。
3. 已在其他 run 中 pending 的 tweets 会标记为 linked_pending，不重复下载。
4. 只有在 API 服务运行时，API worker 才会消费 pending/retryable 的 task items。
5. run 的 verify 只校验本次新影响的媒体，并从 Postgres 汇报全库总数。
6. CLI 的 TXT/JSONL 路径只是输入适配器；系统不使用"被监视的输入目录"。
```

全盘维护为显式动作：

```bash
docker-compose run --rm xarchiver backfill-media --full
docker-compose run --rm xarchiver verify --full
```

这些维护命令会遍历归档文件，对大库可能产生显著磁盘 I/O。`backfill-media` 还会为缺失预览图的视频生成最大宽度 640px 的轻量 JPEG；CSV export 仅读取数据库快照，不会进行媒体文件 hash 扫描。

## 本地 API 与 WebUI

项目在 CLI 使用的同一套 Python 归档内核之上，提供了本地 FastAPI 服务与 React WebUI。

在 Docker 中启动 API：

```bash
docker-compose run --rm --service-ports xarchiver serve
```

compose 文件会将 API 映射到宿主机回环地址：

```text
http://127.0.0.1:18000
```

Web/API 默认启用单管理员登录。首次启动时，从服务日志复制一次性设置令牌：

```bash
docker-compose logs xarchiver
```

打开 WebUI 后填写令牌、管理员用户名与不少于 12 个字符的密码。令牌仅保存在当前进程内，重启后会重新生成，初始化成功后立即失效。忘记密码时可在可信终端运行 `docker-compose run --rm xarchiver auth reset-password`；该命令会撤销全部浏览器会话。CLI 仍是拥有数据库权限的本地运维入口，不经过 Web 登录。

VS Code 可通过一个调试入口构建 API 镜像、启动 API 容器、附加 Python 调试器并启动 WebUI 开发服务器。打开"运行和调试"，选择 `Dev: API + WebUI`，按 F5 启动。API 通过 `debugpy` 在 `127.0.0.1:5678` 上启动并立即响应请求；VS Code 附加后即可命中断点。该调试入口有意不启用 uvicorn reload，因此在 Python 代码变更后需重启调试会话。WebUI 仍通过 Vite 在本地运行，将 API 请求代理到 `http://127.0.0.1:18000`，可手动在 `http://127.0.0.1:5173` 打开。

可用的只读 API endpoints：

```text
GET /health
GET /api/v1/library/summary
GET /api/v1/library/media
GET /api/v1/library/authors
GET /api/v1/library/posts
DELETE /api/v1/library/media
GET /api/v1/library/tweets/{tweet_id}
GET /api/v1/library/failures
GET /api/v1/library/duplicates
GET /api/v1/media-file/{relative_path}
GET /api/v1/archive-runs
GET /api/v1/archive-runs/{run_id}
GET /api/v1/sources
GET /api/v1/sources/{source_id}
GET /api/v1/sources/{source_id}/discovered
GET /api/v1/sources/{source_id}/downloads
GET /api/v1/events
GET /api/v1/settings/download-policy
GET /api/v1/health/detail
```

可用的写 API endpoints 由进程内锁串行化。如果已有写动作正在运行，API 返回 `409 write_action_in_progress`。

```text
POST /api/v1/actions/verify
POST /api/v1/actions/requeue
POST /api/v1/actions/recover-interrupted
POST /api/v1/actions/export
POST /api/v1/archive-runs
POST /api/v1/archive-runs/{run_id}/retry
POST /api/v1/sources
POST /api/v1/sources/{source_id}/records
POST /api/v1/sources/{source_id}/downloads
POST /api/v1/sources/{source_id}/submit-discovered
POST /api/v1/sources/{source_id}/status
POST /api/v1/sources/{source_id}/pin
POST /api/v1/sources/{source_id}/scan
POST /api/v1/sources/{source_id}/history-scan
POST /api/v1/sources/{source_id}/history-scan/stop
POST /api/v1/sources/{source_id}/scan-sessions
POST /api/v1/sources/{source_id}/scan-sessions/pause
POST /api/v1/sources/{source_id}/scan-sessions/resume
POST /api/v1/sources/{source_id}/scan-sessions/stop
POST /api/v1/maintenance/backfill
POST /api/v1/maintenance/verify
```

运行 WebUI：

```bash
cd webui
npm install
npm run dev
```

打开：

```text
http://127.0.0.1:5173
```

WebUI 使用 React、TanStack Query、React Router、Tailwind，以及位于 `webui/src/components/ui` 下的本地 shadcn 风格 UI 组件。

当前页面：

```text
Dashboard
Library
Tweet detail
Failures
Duplicates
Operations
Archive Queue
Sources
```

Archive Queue 支持粘贴 URL 或选择本地 TXT/JSONL 文件（浏览器侧解析后提交）来创建结构化的数据库任务。Operations 可触发 requeue、recover-interrupted 与数据库快照 export。完整 backfill 与完整 verify 被隔离在 Maintenance 下，并要求显式确认磁盘扫描。媒体库和重复媒体页均支持显式勾选并批量永久删除最多 200 个媒体项；重复媒体页按完整 SHA-256 组分页，可为每组保留建议项并选择其余副本。删除会清理主文件、对应元数据、标准缩略图和派生视频预览图，保留 Tweet、来源和下载历史，将 Tweet 标记为 `missing`，并写入幂等删除审计。

Sources 记录长期存在的 X/Twitter 来源，例如个人页、媒体页、likes、bookmarks、搜索页或手工集合。一个 source 可向同一 Archive Queue 提交发现的 tweet URL，同时保留 source-to-tweet 的可追溯关系。当前实现提供了可恢复的 source 模型、手动 discovered-URL 提交，以及用于 profile timeline 和用户媒体页的小批量 `gallery-dl` 扫描。普通 source 扫描只记录 discovered tweets，不会隐式提交下载；用户可以明确创建“更新并下载本轮新增”的组合任务，系统通过扫描运行关联精确圈定本轮首次发现的 Tweet。发现列表可按媒体类型和下载状态服务端筛选，默认下载只提交当前筛选下尚未完成的 Tweet，已完成项不会重新下载。下载提交的 `media_type=video/photo` 是 Tweet 级范围筛选，图文混合 Tweet 会整体处理并下载全部媒体；强制重新下载当前筛选属于高级操作。每次受控扫描会在 `archive_sources.cursor_state` 中记录其逻辑 batch window、重复/新增数量以及 cursor 诊断信息。

Sources 列表支持勾选已加载来源，或冻结最多 200 个“当前筛选全部”来源；可以批量更新最新推文、下载当前缺失项、更新后只下载本轮新增。任务关闭页面后继续运行，并提供逐来源进度、暂停、恢复、取消和失败项重试。列表展示最新 Tweet 发布时间、最近成功同步、未提交/排队/处理/失败下载数、当前任务和下次定时执行；同时支持对应筛选和排序。置顶来源会持久化保存，并始终位于普通来源之前。

命名定时策略支持每 6/12 小时、每日或每周执行，默认关闭。策略可选择只更新，或更新并下载本轮新增；后者默认限制每来源 50、每任务 1000 条。停机错过或执行重叠会合并成一次，计划时间是 not-before。扫描与下载共享单个网络 worker，在两类工作同时就绪时交替执行；多个下载 run 按最近派发时间轮转，避免大型旧 run 长时间独占队列。

2026-05-27 的真实验证表明，数值区间不是深层媒体历史的高效延续机制。source collector 现已持久化 Twitter extractor 的原生 continuation cursor，并将其用于历史批次。每次 source scan 尝试都会写入 `source_scan_runs`，包含其 range、cursor 快照、计数、结果与错误摘要。Sources 详情页展示最近 20 次扫描事件与累计统计，使得停滞的 history scan 可在重启后脱离容器日志进行诊断。运行中的扫描会将完整的 `gallery-dl` 日志以 JSONL 操作日志流形式写入 `archive/logs/source-scan-logs/`；下载任务同样会把脱敏后的 `gallery-dl` / `yt-dlp` stdout 与 stderr 写入 `archive/logs/download-logs/`。数据库仅存储日志流 ID、相对路径、各级别计数器、最新进度等摘要字段。WebUI 的 source 日志面板、推文详情和 `Operations -> Logs` 通过 API 读取这些日志流；升级前已完成的下载任务仅保留错误摘要。

按钮含义与操作流程见 [`docs/source-scanning-workflow.md`](docs/source-scanning-workflow.md)，真实验证中发现的原生 cursor 阻塞问题见 [`docs/source-scanning-acceptance.md`](docs/source-scanning-acceptance.md)。

## 命令

干跑（dry-run）下载任务，不调用下载器：

```bash
docker-compose run --rm xarchiver download --engine gallery-dl --dry-run
```

从 `archive/media` 下已有文件重建 `media_assets`，并补齐历史视频的 `.preview.jpg`（显式全盘维护）：

```bash
docker-compose run --rm xarchiver backfill-media --full
```

校验整个媒体库的文件存在性与哈希（显式全盘维护）：

```bash
docker-compose run --rm xarchiver verify --full
```

导出已校验的媒体：

```bash
docker-compose run --rm xarchiver export --format csv
```

导出所有媒体状态：

```bash
docker-compose run --rm xarchiver export --format csv --status all
```

导出失败项：

```bash
docker-compose run --rm xarchiver export-failures
```

重新入队可重试、缺失或损坏的 tweets：

```bash
docker-compose run --rm xarchiver requeue
docker-compose run --rm xarchiver requeue --status failed_retryable --status missing
```

恢复因中断导致 job 或 tweet 留在 running/downloading 状态的 run：

```bash
docker-compose run --rm xarchiver recover-interrupted
docker-compose run --rm xarchiver recover-interrupted --timeout-minutes 30
```

导出已校验媒体的静态 HTML 图库：

```bash
docker-compose run --rm xarchiver export-gallery
docker-compose run --rm xarchiver export-gallery --status all
```

搜索已归档媒体：

```bash
docker-compose run --rm xarchiver search --author veritasium
docker-compose run --rm xarchiver search --text chaos --media-type video
docker-compose run --rm xarchiver search --media-status all --limit 50
```

按 sha256 查找重复媒体：

```bash
docker-compose run --rm xarchiver duplicates
docker-compose run --rm xarchiver export-duplicates
```

`GET /api/v1/library/duplicates` 的 `limit/offset` 以重复组为单位，响应通过 `groups` 返回当前页完整分组；组内媒体包含稳定的 `media_assets.id`，WebUI 使用该 ID 调用统一的物理删除接口。CLI 与 CSV 导出仍保持平铺媒体行格式。

生产部署的完整说明（包括 Supabase 元数据存储、连接选择、迁移检查、服务运行、调优以及备份/恢复流程）见统一手册 [`docs/deploy/`](docs/deploy/README.md)。

开发环境默认将宿主机 `5333` 映射到 Postgres 容器的 `5432`。如需覆盖默认宿主机端口：

```bash
POSTGRES_PORT=5434 docker-compose up -d postgres
```

重试行为由环境变量控制：

```text
RETRY_LIMIT=3
RETRY_BACKOFF_MINUTES=15
QUEUE_BATCH_SIZE=20
DOWNLOADER_SLEEP_MIN_SECONDS=0
DOWNLOADER_SLEEP_MAX_SECONDS=3
DOWNLOADER_PROGRESS_FALLBACK_INTERVAL_SECONDS=10
SOURCE_SCAN_BATCH_SIZE=20
SOURCE_SCAN_SLEEP_MIN_SECONDS=0
SOURCE_SCAN_SLEEP_MAX_SECONDS=3
SOURCE_SCAN_HTTP_TIMEOUT_SECONDS=15
SOURCE_SCAN_HTTP_RETRIES=2
STUCK_TIMEOUT_MINUTES=120
API_HOST=0.0.0.0
API_PORT=18000
FORWARDED_ALLOW_IPS=127.0.0.1,172.18.0.0/16
AUTH_MODE=password
AUTH_COOKIE_SECURE=auto
AUTH_SESSION_TTL_HOURS=168
RUNTIME_WS_ENABLED=true
```

生产环境只支持 WebUI 与 API 同源部署，公网入口必须经过 HTTPS 反向代理。通用生产模板强制 `AUTH_COOKIE_SECURE=true`，避免代理协议头配置错误时静默下发非 Secure Cookie；只有仓库提供的 Traefik 混合入口叠加文件会单独覆盖成 `auto`，以兼容 HTTPS 域名与受限的内网 HTTP IP。反向代理实际连接到 Uvicorn 时使用的 IP 或 CIDR 必须列入 `FORWARDED_ALLOW_IPS`；Docker 宿主机反代通常表现为 Compose 网络网关，而不是 `127.0.0.1`，否则所有用户会共享该网关的登录限流键。Traefik 动态容器网络的配置见部署文档。只有明确保持本机隔离时才可设置 `AUTH_MODE=disabled`；禁用后所有 Web/API 路由均不再要求登录。

`QUEUE_BATCH_SIZE` 限制 API worker 每次领取多少条 queued tweet。下载器的 sleep 设置会透传到 `gallery-dl` / `yt-dlp`，避免大批量任务对 X/Twitter 发起紧密的连续请求。下载进度优先读取下载器原生输出，其次只采样当前明确文件；只有两者都不可用时才递归扫描媒体目录。`DOWNLOADER_PROGRESS_FALLBACK_INTERVAL_SECONDS` 控制该兜底扫描间隔，默认 10 秒，设置为 `0` 可禁用。`SOURCE_SCAN_BATCH_SIZE` 与 `SOURCE_SCAN_SLEEP_*` 用于单独控制历史 source 发现（与下载分离）。`SOURCE_SCAN_HTTP_TIMEOUT_SECONDS` 和 `SOURCE_SCAN_HTTP_RETRIES` 收敛单次扫描请求的网络等待；gallery-dl 即使在重试耗尽后返回 0，扫描器也会根据错误日志将该批标记为 `network_error`，且不会推进 cursor。

## 状态规则

`verify` 会检查每个 `media_assets.local_path`：

```text
文件存在且 sha256 匹配     -> verified
文件缺失                  -> missing
文件存在但 sha256 不匹配   -> corrupt
```

Tweet 状态由其子媒体资产聚合：

```text
全部 verified        -> verified
任意 corrupt         -> corrupt
任意 missing         -> missing
否则（混合）          -> partial
```

## 测试

在 Docker 中运行后端测试套件：

```bash
bash scripts/lint_python.sh
docker-compose run --rm xarchiver db reset --yes
docker-compose run --rm --entrypoint python xarchiver -m unittest discover -s /app/tests
```

在 Windows PowerShell 中，lint 步骤使用 `.\scripts\lint_python.ps1`。

在较大交付前，运行完整的本地验证集：

```bash
# Backend: reset disposable metadata DB and run all Python tests.
bash scripts/lint_python.sh
docker-compose run --rm xarchiver db reset --yes
docker-compose run --rm --entrypoint python xarchiver -m unittest discover -s /app/tests

# WebUI: regenerate OpenAPI types and build.
cd webui
npm run generate:api-types
npm run check
cd ..

# Browser extension: typecheck and build.
cd extension
npm run check
cd ..
```

后端 reset 只会清空 Postgres 元数据，不会删除 `archive/` 下的媒体文件。这些检查不会对真实 X/Twitter 做批量扫描或下载。

该套件覆盖：

```text
tweet URL parsing
gallery-dl metadata parsing
yt-dlp metadata parsing and normalization
verify aggregation rules
missing/corrupt/recovery integration flow
```

GitHub Actions CI 流水线会在重置后的测试数据库上运行同一套后端测试，并在 `webui/` 与 `extension/` 中执行 `npm run check`。测试隔离契约见 [`docs/engineering-ci-and-test-isolation.md`](docs/engineering-ci-and-test-isolation.md)。

## 浏览器扩展

扩展是一个 WXT + React 项目，使用 TypeScript 与原生 Chrome 扩展 i18n。

安装依赖：

```bash
cd extension
npm install
```

以 WXT 开发模式运行扩展：

```bash
npm run dev
```

构建 Chrome/Edge 生产 bundle：

```bash
npm run build
npm run zip
```

在 Chrome 或 Edge 中加载生产 build：

```text
1. Open chrome://extensions
2. Enable Developer mode
3. Click Load unpacked
4. Select extension/.output/chrome-mv3/
```

在 X/Twitter 页面（likes、bookmarks、profile、search 或 home）上使用：

```text
1. Open the target page on x.com or twitter.com
2. Click the X Media Archiver extension icon
3. Click Scan visible to collect currently mounted tweets
4. Click Auto scroll to keep scrolling and scanning
5. Click Stop when enough tweets are collected
6. Export URLs or JSONL
```

导出文件：

```text
tweet_urls_<timestamp>.txt    每行一个明确的 /status/<tweet_id> URL
tweets_<timestamp>.jsonl      更丰富的记录（供 xarchiver 导入）
scan_stats_<timestamp>.json   扫描来源、耗时、计数与 auto-scroll 结果
```

弹窗也允许你在启动长时间 auto-scroll 扫描前，设置最大滚动轮次、连续空轮次数以及扫描间隔。

Popup UI 文案位于：

```text
extension/public/_locales/en/messages.json
extension/public/_locales/zh_CN/messages.json
```

将扩展导出内容导入 CLI：

```bash
docker-compose run --rm xarchiver import-urls /app/examples/tweet_urls.example.txt
docker-compose run --rm xarchiver import /app/examples/tweets.example.jsonl
```

从浏览器导出文件后，请将其放到 `examples/` 或其他已挂载目录下，再在 Docker 中导入。
