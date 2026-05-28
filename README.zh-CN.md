# x-media-archiver

本地优先（local-first）的 X/Twitter 媒体归档工具。V0 聚焦在 Docker 化的 CLI 流水线：

```text
tweet URLs -> scoped download -> scoped media_assets backfill -> scoped verify
```

## V0 快速开始

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

cookie 文件必须使用 Netscape cookie 格式。请仅保留在本地；该文件已被 git 忽略。

用每行一个 tweet URL 替换 `examples/tweet_urls.example.txt`：

```text
https://x.com/PhysInHistory/status/2058554692586885322
https://x.com/dpoddolphinpro/status/2059072547585433944
```

类似 `https://x.com/XiangHupt/likes` 的 profile URL 不是 V0 的合法输入。V0 需要明确的 `/status/<tweet_id>` URL。

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

用户名会保存在 Postgres 元数据中用于搜索与展示，但不作为文件系统目录名的主键（主目录名使用更稳定的 `author_id`）。

从浏览器扩展导出 URL 后，推荐的一条命令式工作流：

```bash
docker-compose run --rm xarchiver archive-urls /app/examples/tweet_urls.example.txt
```

该命令会解析本地文件并提交一个基于数据库的归档 run。`xarchiver serve` 运行时，API worker 会处理队列中的 tweet，使用 scoped 下载、回填与校验操作。需要数据库快照时再单独运行导出命令。

也可通过同一服务提交 JSONL 输入：

```bash
docker-compose run --rm xarchiver archive-jsonl /app/examples/tweets.example.jsonl
```

## 命令

干跑（dry-run）下载任务，不调用下载器：

```bash
docker-compose run --rm xarchiver download --engine gallery-dl --dry-run
```

从 `archive/media` 下已有文件重建 `media_assets`（显式全盘维护）：

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

生产环境在 Supabase 中存储元数据（包含连接选择与迁移检查）的说明见 [docs/supabase-deployment.md](docs/supabase-deployment.md)。备份与恢复流程见 [docs/backup-restore.md](docs/backup-restore.md)。

如果本地端口 5432 已被占用，可覆盖开发 Postgres 的宿主机映射端口：

```bash
POSTGRES_PORT=5434 docker-compose up -d postgres
```

重试行为由环境变量控制：

```text
RETRY_LIMIT=3
RETRY_BACKOFF_MINUTES=15
QUEUE_BATCH_SIZE=20
DOWNLOADER_SLEEP_MIN_SECONDS=2
DOWNLOADER_SLEEP_MAX_SECONDS=6
SOURCE_SCAN_BATCH_SIZE=20
SOURCE_SCAN_SLEEP_MIN_SECONDS=20
SOURCE_SCAN_SLEEP_MAX_SECONDS=45
STUCK_TIMEOUT_MINUTES=120
API_HOST=0.0.0.0
API_PORT=8000
```

`QUEUE_BATCH_SIZE` 限制 API worker 每次领取多少条 queued tweet。下载器 sleep 设置会透传到 `gallery-dl` / `yt-dlp`，用于避免大批量任务对 X/Twitter 发起紧密的连续请求。`SOURCE_SCAN_BATCH_SIZE` 与 `SOURCE_SCAN_SLEEP_*` 用于单独控制历史 source 发现（与下载分离）。

## 本地 API 与 WebUI

Phase 2 在同一套 Python 归档内核（CLI 与 API 共用）之上增加本地 FastAPI 服务与 React WebUI。

在 Docker 中启动 API：

```bash
docker-compose run --rm --service-ports xarchiver serve
```

compose 文件会将 API 映射到宿主机回环地址：

```text
http://127.0.0.1:8000
```

可用的只读 API endpoints：

```text
GET /health
GET /api/v1/library/summary
GET /api/v1/library/media
GET /api/v1/library/tweets/{tweet_id}
GET /api/v1/library/failures
GET /api/v1/library/duplicates
GET /api/v1/media-file/{relative_path}
GET /api/v1/archive-runs
GET /api/v1/archive-runs/{run_id}
GET /api/v1/sources
GET /api/v1/sources/{source_id}
GET /api/v1/events
GET /api/v1/settings/download-policy
GET /api/v1/health/detail
```

可用的写 API endpoints 由进程内锁串行化。如果已有写动作在运行，API 返回 `409 write_action_in_progress`。

```text
POST /api/v1/actions/verify
POST /api/v1/actions/requeue
POST /api/v1/actions/recover-interrupted
POST /api/v1/actions/export
POST /api/v1/archive-runs
POST /api/v1/archive-runs/{run_id}/retry
POST /api/v1/sources
POST /api/v1/sources/{source_id}/records
POST /api/v1/sources/{source_id}/submit-discovered
POST /api/v1/sources/{source_id}/status
POST /api/v1/sources/{source_id}/scan
POST /api/v1/sources/{source_id}/history-scan
POST /api/v1/sources/{source_id}/history-scan/stop
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

Archive Queue 支持粘贴 URL 或选择本地 TXT/JSONL 文件（浏览器侧解析后提交）来创建结构化的数据库任务。Operations 可触发 requeue、recover-interrupted 与数据库快照 export。完整 backfill 与完整 verify 被隔离在 Maintenance 下，并要求显式确认磁盘扫描。WebUI 不提供破坏性的文件删除能力。

Sources 记录长期存在的 X/Twitter 来源，例如个人页、媒体页、likes、bookmarks、搜索页或手工集合。一个 source 可向同一 Archive Queue 提交发现的 tweet URL，并保留 source-to-tweet 的可追溯关系。当前实现提供可恢复的 source 模型、手动提交 discovered-URL，以及用于 profile timeline 与用户媒体页的小批量 `gallery-dl` 扫描。source 扫描只记录 discovered tweets；不会自动提交到下载队列。准备下载受控批次时，需使用显式的 submit 动作。每次受控扫描会记录其逻辑 batch window、重复/新增数量，以及 `archive_sources.cursor_state` 中的 cursor 诊断信息。
2026-05-27 的真实验证表明，数值区间不是深历史媒体的高效延续机制。source collector 现已持久化 Twitter extractor 的原生 continuation cursor，并用于历史批次。扫描只做发现记录，绝不自动提交下载。每次 source scan 尝试（以及因下载进行中导致的 defer）都会写入 `source_scan_runs`，包含其 range、cursor 快照、计数、结果与错误摘要，从而可在重启后不依赖容器日志诊断停滞的 history scan。Sources 详情页展示最近 20 次扫描事件与累计统计。

按钮含义与操作流程见 [docs/source-scanning-workflow.md](docs/source-scanning-workflow.md)，原生 cursor 的阻塞问题见 [docs/source-scanning-acceptance.md](docs/source-scanning-acceptance.md)。

## Archive Queue

归档提交会在 Postgres 中存为 runs 与 per-tweet task items：

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
6. CLI 的 TXT/JSONL 路径只是输入适配器；系统不使用“被监视的输入目录”。
```

全盘维护为显式动作：

```bash
docker-compose run --rm xarchiver backfill-media --full
docker-compose run --rm xarchiver verify --full
```

这些维护命令会遍历归档文件，对大库可能产生显著磁盘 I/O。CSV export 只读取数据库快照，不会进行媒体文件 hash 扫描。

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
docker-compose run --rm xarchiver db reset --yes
docker-compose run --rm --entrypoint python xarchiver -m unittest discover -s /app/tests
```

在较大交付前，运行完整的本地验证集：

```bash
# Backend: reset disposable metadata DB and run all Python tests.
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

GitHub Actions CI 会在重置后的测试数据库上运行同一套后端测试，并在 `webui/` 与 `extension/` 中执行 `npm run check`。测试隔离契约见 [docs/engineering-ci-and-test-isolation.md](docs/engineering-ci-and-test-isolation.md)。

## 浏览器扩展 V0

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

弹窗也允许设置最大滚动轮次、连续空轮次数，以及开始长时间 auto-scroll 扫描前的扫描间隔。

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

从浏览器下载导出文件后，请将其放到 `examples/` 或其他已挂载目录下，再在 Docker 中导入。

