# x-media-archiver 生产部署手册

最后更新：2026-05-29

本手册整合了原先分散的部署、数据库与备份恢复文档，是 x-media-archiver 生产环境的统一操作指南。内容涵盖：前置条件、密钥与环境配置、Supabase Postgres 接入、服务运行、WebUI 构建、运行参数调优、备份与恢复，以及日常运维与安全清单。

如果只想快速试用，请先看仓库根目录的 [README.zh-CN.md](../../README.zh-CN.md)；本手册面向长期、可恢复的生产归档。

## 目录

```text
1. 架构与数据面
2. 前置条件
3. 密钥与环境配置
4. 数据库：Supabase Postgres
5. 服务运行
6. WebUI 构建与发布
7. 运行参数与调优
8. 备份与恢复
9. 运维与监控
10. 安全清单
11. 官方参考资料
```

---

## 1. 架构与数据面

系统是本地优先（local-first）的归档工具：**元数据存 Postgres，媒体文件存本地磁盘**。这两者是两个彼此独立的数据面，备份与恢复时必须分别对待：

```text
Postgres（可用 Supabase） -> tweet、media、job、source 与 attempt 元数据
本地 archive/             -> 下载的图片/视频、下载器状态、生成的导出
```

只恢复数据库备份无法找回媒体文件；只备份媒体也无法还原归档状态。两者都要纳入备份策略。

因为媒体始终落在本地 `archive/` 卷，所以用 Supabase 托管的 Postgres 替代本地 Docker Postgres **不会改变归档目录或下载流程**——只是把元数据存储指向远端数据库。

运行时由同一套 Python 内核（CLI 与 FastAPI 共用）驱动：

```text
WebUI / 浏览器扩展导出 / CLI 文件解析
  -> archive_runs + archive_run_items（入库为结构化任务）
  -> API 后台 worker（serve 进程内）
  -> scoped download / backfill / verify
  -> archive/media、archive/exports、archive/state
```

---

## 2. 前置条件

```text
Docker + Docker Compose（compose v2 `docker compose` 或 v1 `docker-compose` 均可）
一个 Postgres 数据库（生产推荐 Supabase；本地开发用 compose 内置 postgres）
导出的 X/Twitter cookies（Netscape 格式）
WebUI 构建需要 Node.js 22
```

构建 CLI/API 镜像并初始化归档目录：

```bash
docker compose build xarchiver
docker compose run --rm xarchiver init /app/archive
```

镜像基于 `python:3.12-slim`，内置 `ffmpeg`、`gallery-dl`、`yt-dlp` 等依赖（见 [`cli/Dockerfile`](../../cli/Dockerfile) 与 [`cli/requirements.txt`](../../cli/requirements.txt)）。

---

## 3. 密钥与环境配置

### 3.1 cookies

把导出的 X/Twitter cookies 放到仓库根目录：

```text
secrets/cookies.txt
```

要求与约束：

```text
1. 必须是 Netscape cookie 格式。
2. 该文件被 .gitignore 忽略，仅保留在本地，绝不提交。
3. compose 以只读方式挂载 secrets/ 到容器 /app/secrets。
```

### 3.2 生产环境变量文件

在仓库根目录创建一个**不纳入版本控制**的 `.env.production`（`.env.*` 已被 git 忽略，仅 `.env.example` 例外）：

```env
DATABASE_URL=postgresql://postgres.PROJECT_REF:URL_ENCODED_PASSWORD@aws-0-REGION.pooler.supabase.com:5432/postgres?sslmode=require
ARCHIVE_DIR=/app/archive
COOKIE_FILE=/app/secrets/cookies.txt
DEFAULT_DOWNLOAD_ENGINE=gallery-dl
RETRY_LIMIT=3
```

完整可调参数见第 7 节。`.env.example` 提供了所有键的本地默认值，可作为起点。

### 3.3 不要提交的内容

```text
数据库密码、连接串、自定义角色密码
secrets/cookies.txt
Supabase 服务器根证书（secrets/prod-supabase.cer）
任何 .env / .env.production 文件
```

如果数据库密码包含 `@`、`#`、`/`、`:` 等字符，写入 `DATABASE_URL` 前必须先做 URL 编码。

---

## 4. 数据库：Supabase Postgres

生产环境推荐用 Supabase 托管 Postgres 存储元数据。下载的媒体文件依然保存在本地 `archive/` 卷。

### 4.1 连接方式选择

请使用 Supabase 项目控制台 **Connect** 面板中的连接串。

| 操作 | 推荐连接方式 |
| --- | --- |
| 在具备 IPv6 的持久环境中运行 CLI | Direct connection，端口 `5432` |
| 在仅支持 IPv4 的网络中运行 CLI | Supavisor Session pooler，端口 `5432` |
| 执行迁移、`pg_dump` 或恢复 | 优先使用 Direct connection；不可用时使用 Session pooler |

执行迁移或备份恢复操作时，**不要使用端口 `6543` 的 Transaction pooler**。

### 4.2 更严格的 TLS 校验（可选）

如果希望使用更严格的服务端身份校验，请从 Supabase 控制台下载服务器根证书，保存到
`secrets/prod-supabase.cer`，然后使用：

```env
DATABASE_URL=postgresql://postgres.PROJECT_REF:URL_ENCODED_PASSWORD@aws-0-REGION.pooler.supabase.com:5432/postgres?sslmode=verify-full&sslrootcert=/app/secrets/prod-supabase.cer
```

### 4.3 运行迁移

CLI 服务默认会等待本地 Docker Postgres 启动。改为连接 Supabase 时，请使用 `--no-deps`，
避免本地数据库一并启动：

```bash
docker compose --env-file .env.production run --rm --no-deps xarchiver db migrate
```

迁移执行器会维护 `xarchiver_schema_migrations` 表：

```text
new SQL file       -> applied once and recorded with checksum
known SQL file     -> skipped
changed known file -> refused; add a new numbered migration instead
```

迁移脚本位于 [`sql/`](../../sql/)，按编号顺序应用（`001_init.sql` … `009_worker_lease.sql`）。新增 schema 变更时**追加一个新的编号迁移**，不要修改已应用的旧脚本——执行器会因校验和不一致而拒绝。

对于已有的 V0 数据库，首次启用迁移跟踪后会重新执行 `001_init.sql`。由于该脚本使用了
`if not exists`，因此可以安全重跑，随后系统会记录其校验和。

### 4.4 验证新数据库

在将长期运行的归档任务指向该数据库之前，请先使用一个可丢弃的 Supabase 项目或全新的
schema 进行验证：

```bash
docker compose --env-file .env.production run --rm --no-deps xarchiver db migrate
docker compose --env-file .env.production run --rm --no-deps xarchiver import /app/examples/tweets.example.jsonl
docker compose --env-file .env.production run --rm --no-deps xarchiver status
docker compose --env-file .env.production run --rm --no-deps xarchiver export --format csv --status all
```

然后在 Supabase SQL Editor 中检查：

```sql
select filename, applied_at
from xarchiver_schema_migrations
order by filename;

select download_status, count(*)
from tweets
group by download_status
order by download_status;
```

只有在上述检查通过后，才应接入真实归档数据。即使元数据存储在 Supabase 中，已下载的
文件依然保存在本地 `archive/` 卷中。

### 4.5 只读检查查询

常用检查查询见 [`read-only-queries.sql`](./read-only-queries.sql)。这些查询只读取应用表，
可以直接粘贴到 Supabase SQL Editor 中执行，也可以作为后续构建仪表盘的基础。

---

## 5. 服务运行

### 5.1 启动 API 与后台 worker

`serve` 启动 FastAPI 服务，并在进程内拉起两个后台 daemon：归档队列 worker 与来源扫描 worker。这是生产运行的核心命令：

```bash
docker compose --env-file .env.production run --rm --no-deps --service-ports xarchiver serve
```

compose 文件会将 API 映射到宿主机回环地址：

```text
http://127.0.0.1:8000
```

> 安全说明：API 默认只绑定 `127.0.0.1`（compose 中端口映射为 `127.0.0.1:${API_PORT}:8000`），**没有内建鉴权**。这是单用户本地工具的有意设计。不要把该端口直接暴露到公网；如需远程访问，请在前面放置带鉴权的反向代理或 SSH 隧道。

### 5.2 后台 worker 行为

`serve` 运行时：

```text
1. 归档队列 worker 消费 archive_run_items 中 pending / failed_retryable 的任务，做 scoped 下载/回填/校验。
2. 来源扫描 worker 按 cursor 推进历史扫描，只记录发现，不自动提交下载。
3. 两个 worker 用持久化 lease + 心跳续约（sql/009_worker_lease.sql）防止进程崩溃后任务永久卡死。
```

崩溃恢复：进程异常退出后，状态停留在 `processing` / `running` 的行会在 lease 过期后被新 worker 重新认领，无需手工清理。若仍发现遗留卡住的任务，可用 `recover-interrupted`（见下）。

### 5.3 一次性 CLI 操作

CLI 与 API 共用同一内核，可在不启动服务的情况下直接执行批处理操作。指向生产数据库时同样带 `--env-file` 与 `--no-deps`：

```bash
# 提交归档任务（文件解析为输入适配器）
docker compose --env-file .env.production run --rm --no-deps xarchiver archive-urls /app/examples/tweet_urls.example.txt
docker compose --env-file .env.production run --rm --no-deps xarchiver archive-jsonl /app/examples/tweets.example.jsonl

# 查看队列与库状态
docker compose --env-file .env.production run --rm --no-deps xarchiver status

# 重新入队可重试 / 缺失 / 损坏项
docker compose --env-file .env.production run --rm --no-deps xarchiver requeue

# 恢复因中断卡在 running/downloading 的 run
docker compose --env-file .env.production run --rm --no-deps xarchiver recover-interrupted

# 显式全盘维护（大库有显著磁盘 I/O）
docker compose --env-file .env.production run --rm --no-deps xarchiver backfill-media --full
docker compose --env-file .env.production run --rm --no-deps xarchiver verify --full

# 数据库快照导出（只读数据库，不扫描媒体）
docker compose --env-file .env.production run --rm --no-deps xarchiver export --format csv --status all
```

完整命令清单见根目录 README。来源扫描与下载的业务边界、按钮含义见
[../source-scanning-workflow.md](../source-scanning-workflow.md)。

### 5.4 媒体文件落盘结构

```text
archive/media/<author_id>/<tweet_id>/<tweet_id>--p<media_index>.<ext>
archive/exports/   CSV / HTML 图库导出
archive/state/     下载器状态与运行时 cookie 副本
```

主目录名使用稳定的 `author_id`；用户名保存在 Postgres 元数据中用于搜索与展示。

---

## 6. WebUI 构建与发布

WebUI 是 React + Vite 应用，构建产物为静态资源。需要 Node.js 22。

### 6.1 本地开发

```bash
cd webui
npm install
npm run dev      # http://127.0.0.1:5173
```

### 6.2 生产构建

```bash
cd webui
npm run generate:api-types   # 从后端 OpenAPI 重新生成 TS 类型（需 Docker 起后端）
npm run build                # tsc --noEmit && vite build，产物在 webui/dist/
```

`webui/dist/` 已被 git 忽略。把它部署到任意静态服务器，或与上面的反向代理同源托管，使其能访问 API（默认 `http://127.0.0.1:8000`）。

### 6.3 API 契约校验

后端 schema 与前端类型可能漂移。CI 通过 [`scripts/check_api_contract.sh`](../../scripts/check_api_contract.sh)（workflow [`api-contract.yml`](../../.github/workflows/api-contract.yml)）校验：重新生成 `generated.ts` 并 diff 仓库内版本，不一致即失败。修复方式：

```bash
cd webui && npm run generate:api-types   # 然后提交更新后的 generated.ts
```

---

## 7. 运行参数与调优

所有参数通过环境变量配置（compose 会透传，缺省时用 `.env.example` 中的默认值）。

### 7.1 数据库与服务

```env
DATABASE_URL=...            # Postgres 连接串
ARCHIVE_DIR=/app/archive    # 容器内归档根目录
COOKIE_FILE=/app/secrets/cookies.txt
API_HOST=0.0.0.0            # 容器内监听地址（对外仍由 compose 绑定 127.0.0.1）
API_PORT=8000
```

### 7.2 下载与重试

```env
DEFAULT_DOWNLOAD_ENGINE=gallery-dl
RETRY_LIMIT=3
RETRY_BACKOFF_MINUTES=15
STUCK_TIMEOUT_MINUTES=120
QUEUE_BATCH_SIZE=20            # API worker 每轮领取的 queued tweet 数
DOWNLOADER_SLEEP_MIN_SECONDS=2 # 透传给 gallery-dl / yt-dlp，避免紧密连续请求
DOWNLOADER_SLEEP_MAX_SECONDS=6
```

### 7.3 来源扫描（与下载独立）

```env
SOURCE_SCAN_BATCH_SIZE=20         # native cursor 模式下每批目标 Tweet 窗口
SOURCE_SCAN_SLEEP_MIN_SECONDS=20
SOURCE_SCAN_SLEEP_MAX_SECONDS=45
```

`SOURCE_SCAN_*` 只影响来源发现，不影响下载队列。调高 sleep 区间可降低触发 X/Twitter 限流的风险，代价是吞吐下降。

### 7.4 本地开发端口冲突

如果本地 5432 已被占用，可覆盖开发 Postgres 的宿主机映射端口（仅影响 compose 内置 postgres）：

```bash
POSTGRES_PORT=5434 docker compose up -d postgres
```

---

## 8. 备份与恢复

归档系统有两类彼此独立的备份面（见第 1 节）。**仅恢复数据库备份，无法找回本地媒体文件。**

### 8.1 大规模归档前

1. 将 `archive/media/` 和 `archive/state/` 备份到独立的本地磁盘或其他备份位置。
2. 在执行迁移或批量修改元数据之前，先创建数据库逻辑导出。
3. 不要把 `secrets/cookies.txt`、数据库密码和证书放进会被共享的备份位置。

### 8.2 数据库逻辑备份

从 Supabase 的 **Connect** 面板获取 Direct 或 Session pooler 的连接串。执行导出时**不要
使用 Transaction pooler**。使用 Supabase CLI：

```bash
supabase db dump --db-url "$DATABASE_URL" -f roles.sql --role-only
supabase db dump --db-url "$DATABASE_URL" -f schema.sql
supabase db dump --db-url "$DATABASE_URL" -f data.sql --use-copy --data-only
```

将这些文件保存在仓库之外，并附上备份日期和项目标识。Supabase 控制台提供的备份可以作为
额外的恢复手段；但在应用迁移之前，本地生成的逻辑导出仍然非常有价值。

### 8.3 恢复演练

在正式用于生产恢复前，先把备份恢复到一个新的、可丢弃的 Supabase 项目中进行演练：

```bash
psql "$RESTORE_DATABASE_URL" -f roles.sql
psql "$RESTORE_DATABASE_URL" -f schema.sql
psql "$RESTORE_DATABASE_URL" -f data.sql
```

然后执行校验：

```sql
select count(*) as tweets from tweets;
select count(*) as media_assets from media_assets;
select download_status, count(*) from tweets group by download_status order by download_status;
select filename, checksum from xarchiver_schema_migrations order by filename;
```

挂载一份本地 `archive/` 备份副本，并运行：

```bash
docker compose --env-file .env.production run --rm --no-deps xarchiver verify
docker compose --env-file .env.production run --rm --no-deps xarchiver export --format csv --status all
```

进行恢复演练时，不要让校验流程直接指向你唯一的一份归档媒体数据。

### 8.4 恢复检查清单

- 数据库表和迁移历史都已恢复到位。
- 推文和媒体记录数量与备份前导出的结果相比大致合理。
- 本地媒体备份已单独恢复。
- `verify` 输出的 verified/missing/corrupt 状态符合预期。
- 恢复出的项目提升为正式环境后，数据库密码以及所有自定义角色密码都已重置。

---

## 9. 运维与监控

### 9.1 健康检查

```text
GET /health               基础存活检查
GET /api/v1/health/detail 详情，含 db_pool（active / idle / waiting）等
```

数据库连接由 `psycopg_pool` 连接池管理（`min_size=2, max_size=10`）。数据库连接被中断时，连接池会自动重建，不会级联失败。

### 9.2 写操作并发

写动作由进程内锁串行化。如果已有写动作在运行，写 API 返回 `409 write_action_in_progress`。这是预期行为，重试即可。

### 9.3 状态规则（用于排查）

`verify` 检查每个 `media_assets.local_path`：

```text
文件存在且 sha256 匹配     -> verified
文件缺失                  -> missing
文件存在但 sha256 不匹配   -> corrupt
```

Tweet 状态由其子媒体资产聚合：

```text
全部 verified  -> verified
任意 corrupt   -> corrupt
任意 missing   -> missing
否则（混合）    -> partial
```

排查失败项可用 `read-only-queries.sql` 中的查询，或 `xarchiver export-failures`。

### 9.4 CI 与测试隔离

CI 会构建后端镜像、在重置后的测试库上跑后端测试，并在 `webui/` 与 `extension/` 执行 `npm run check`，外加 API 契约校验。详见
[../engineering-ci-and-test-isolation.md](../engineering-ci-and-test-isolation.md)。

> 重要：不要在 CI 中提供真实 X/Twitter cookies。测试必须使用 mock、fixture 或本地文件。

---

## 10. 安全清单

部署前与提升为生产前逐项确认：

- [ ] `secrets/cookies.txt` 为 Netscape 格式，且未被提交。
- [ ] `.env.production` 未被提交，密码已 URL 编码。
- [ ] 生产连接串使用 Direct 或 Session pooler，迁移/备份未走 Transaction pooler（端口 6543）。
- [ ] 如启用 `verify-full`，根证书放在 `secrets/prod-supabase.cer` 且未提交。
- [ ] API 端口未直接暴露公网；远程访问经过带鉴权的反向代理或隧道。
- [ ] 数据库逻辑备份保存在仓库之外，本地 `archive/` 已单独备份。
- [ ] 恢复演练在可丢弃项目上完成，未指向唯一的媒体数据副本。
- [ ] 项目提升为正式环境后，数据库密码与所有自定义角色密码已重置。

---

## 11. 官方参考资料

- Supabase 连接：<https://supabase.com/docs/guides/database/connecting-to-postgres>
- SSL 强制：<https://supabase.com/docs/guides/platform/ssl-enforcement>
- 备份恢复：<https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore/>
- 平台备份：<https://supabase.com/docs/guides/platform/backups>
