# x-media-archiver 生产部署手册

最后更新：2026-05-29

本手册是 x-media-archiver 生产环境的统一操作指南。**推荐用预构建镜像部署**：一个自包含镜像同时含 FastAPI 后端与构建好的 WebUI（同源 serve），服务器只需 `docker pull` + 一份 compose 即可启动，并支持随镜像附带 Postgres 或接外部 Supabase。手册同时保留从源码运行的开发路径。

如果只想快速试用，请先看仓库根目录的 [README.zh-CN.md](../../README.zh-CN.md)；本手册面向长期、可恢复的生产归档。

## 目录

```text
1.  架构与数据面
2.  镜像部署（推荐：pull & run）
3.  发布镜像（GitHub Actions）
4.  前置条件与密钥配置
5.  数据库：外部 Postgres / Supabase
6.  从源码运行（开发路径）
7.  WebUI 构建与契约校验
8.  运行参数与调优
9.  备份与恢复
10. 运维与监控
11. 安全清单
12. 参考资料
```

---

## 1. 架构与数据面

系统是本地优先（local-first）的归档工具：**元数据存 Postgres，媒体文件存本地磁盘**。这两者是两个彼此独立的数据面，备份与恢复时必须分别对待：

```text
Postgres（自带或 Supabase） -> tweet、media、job、source 与 attempt 元数据
本地 archive/               -> 下载的图片/视频、下载器状态、生成的导出
```

只恢复数据库备份无法找回媒体文件；只备份媒体也无法还原归档状态。两者都要纳入备份策略。

运行时由同一套 Python 内核（CLI 与 FastAPI 共用）驱动。生产镜像中，FastAPI 在同一进程、同一端口上既提供 API（`/api/v1/*`、`/health`）又托管构建好的 WebUI 静态资源（根路径 `/`，带 SPA fallback），因此前后端**同源**，无需单独部署前端：

```text
WebUI（同源静态资源） / 浏览器扩展导出 / CLI 文件解析
  -> archive_runs + archive_run_items（入库为结构化任务）
  -> API 后台 worker（serve 进程内）
  -> scoped download / backfill / verify
  -> archive/media、archive/exports、archive/state
```

---

## 2. 镜像部署（推荐：pull & run）

适用于飞牛 NAS、群晖 NAS 或任意装有 Docker 的服务器。镜像构建为多架构（`linux/amd64` + `linux/arm64`），每台设备只会拉取与自身 CPU 匹配的那一份，无冗余。

### 2.1 准备目录与文件

在服务器上建一个部署目录，放入三样东西：

```text
docker-compose.prod.yml        从仓库复制
.env.production                从 .env.production.example 复制并填写
secrets/cookies.txt            导出的 X/Twitter cookies（Netscape 格式）
archive/                       归档媒体落盘目录（compose 会自动创建挂载）
```

`docker-compose.prod.yml` 与 `.env.production.example` 见仓库根目录。`app` 服务默认镜像为 `ghcr.io/<owner>/x-media-archiver:latest`，可改为 Docker Hub 镜像或固定版本号（如 `:1.0.0`）。

### 2.2 配置环境变量

复制示例并编辑：

```bash
cp .env.production.example .env.production
```

`.env.production` 默认指向**随镜像附带的 Postgres**（compose 内的 `postgres` 服务）。务必修改 `POSTGRES_PASSWORD`，并让 `DATABASE_URL` 中的密码与之一致：

```env
POSTGRES_PASSWORD=<强密码>
DATABASE_URL=postgresql://xarchiver:<强密码>@postgres:5432/xarchiver
```

若改用**外部 Postgres / Supabase**，把 `DATABASE_URL` 指向外部库（见第 5 节），并删除 `docker-compose.prod.yml` 中的 `postgres` 服务与 `app` 的 `depends_on` 块。

### 2.3 启动

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml up -d
docker compose --env-file .env.production -f docker-compose.prod.yml logs -f app
```

容器入口（[`cli/docker-entrypoint.sh`](../../cli/docker-entrypoint.sh)）在启动 API 前会**自动执行数据库迁移**（幂等、带校验和保护，重复启动安全）。首次启动日志会出现 `Applied migration: ...`。随后访问：

```text
http://127.0.0.1:8000
```

> 安全说明：API **没有内建鉴权**，这是单用户本地工具的有意设计。compose 默认把端口绑到宿主机回环 `127.0.0.1`。不要把该端口直接暴露公网；如需远程访问，请在前面放置带鉴权的反向代理或经 SSH/VPN 隧道。

### 2.4 升级版本

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml pull app
docker compose --env-file .env.production -f docker-compose.prod.yml up -d app
```

新镜像启动时会自动应用新增迁移，无需手工操作。媒体与数据库数据分别保存在 `./archive` 与 `pg_data` 卷中，升级不丢数据。

### 2.5 一次性 CLI 操作

镜像入口对非 `serve` 参数会直接透传给 CLI，可在不影响常驻服务的情况下跑批处理：

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml run --rm app status
docker compose --env-file .env.production -f docker-compose.prod.yml run --rm app verify --full
docker compose --env-file .env.production -f docker-compose.prod.yml run --rm app export --format csv --status all
```

---

## 3. 发布镜像（GitHub Actions）

推送形如 `vX.Y.Z` 的发布 tag 会触发 [`.github/workflows/release.yml`](../../.github/workflows/release.yml)，自动用 buildx 构建多架构镜像并发布。

```bash
git tag v1.0.0
git push origin v1.0.0
```

工作流会：

```text
1. 用 QEMU + buildx 构建 linux/amd64 与 linux/arm64。
2. 登录并推送到 GHCR（ghcr.io/<owner>/x-media-archiver）。
3. 若配置了 Docker Hub secrets，同时推送到 docker.io/<user>/x-media-archiver。
4. 从 semver tag 派生镜像标签：X.Y.Z、X.Y、latest。
```

### 3.1 所需仓库 Secrets

```text
GITHUB_TOKEN              GitHub 自动注入，推 GHCR 无需额外配置。
DOCKERHUB_USERNAME        可选；配置后才推 Docker Hub。
DOCKERHUB_TOKEN           可选；Docker Hub access token。
```

未配置 Docker Hub secrets 时，工作流只推 GHCR 并打印一条 warning，不会失败。

### 3.2 校验发布结果

```bash
docker manifest inspect ghcr.io/<owner>/x-media-archiver:latest
```

应能看到 `linux/amd64` 与 `linux/arm64` 两个平台条目。

---

## 4. 前置条件与密钥配置

### 4.1 前置条件

```text
镜像部署：装有 Docker + Docker Compose 的服务器（飞牛/群晖 NAS 均可）。
从源码运行（开发）：额外需要 Node.js 22 构建 WebUI。
两种方式都需要：导出的 X/Twitter cookies（Netscape 格式）。
```

### 4.2 cookies

把导出的 X/Twitter cookies 放到部署目录的 `secrets/` 下：

```text
secrets/cookies.txt
```

```text
1. 必须是 Netscape cookie 格式。
2. 该文件被 .gitignore 忽略，仅保留在本地，绝不提交。
3. compose 以只读方式挂载 secrets/ 到容器 /app/secrets。
```

### 4.3 不要提交的内容

```text
数据库密码、连接串、自定义角色密码
secrets/cookies.txt
Supabase 服务器根证书（secrets/prod-supabase.cer）
任何 .env / .env.production 文件
```

如果数据库密码包含 `@`、`#`、`/`、`:` 等字符，写入 `DATABASE_URL` 前必须先做 URL 编码。`.env.production.example` 与 `.env.example` 不含真实密钥，可纳入版本控制。

---

## 5. 数据库：外部 Postgres / Supabase

镜像部署默认随附 Postgres（见第 2 节）。如需用外部托管库（如 Supabase），按本节配置 `DATABASE_URL`，无论元数据存在哪里，**媒体文件始终落在本地 `archive/` 卷**。

### 5.1 连接方式选择

请使用 Supabase 项目控制台 **Connect** 面板中的连接串。

| 操作 | 推荐连接方式 |
| --- | --- |
| 在具备 IPv6 的持久环境中运行 | Direct connection，端口 `5432` |
| 在仅支持 IPv4 的网络中运行 | Supavisor Session pooler，端口 `5432` |
| 执行迁移、`pg_dump` 或恢复 | 优先 Direct connection；不可用时用 Session pooler |

执行迁移或备份恢复操作时，**不要使用端口 `6543` 的 Transaction pooler**。

### 5.2 外部库的 .env.production

```env
DATABASE_URL=postgresql://postgres.PROJECT_REF:URL_ENCODED_PASSWORD@aws-0-REGION.pooler.supabase.com:5432/postgres?sslmode=require
```

填好后删除 `docker-compose.prod.yml` 中的 `postgres` 服务与 `app` 的 `depends_on` 块。容器启动仍会自动迁移外部库。

### 5.3 更严格的 TLS 校验（可选）

从 Supabase 控制台下载服务器根证书，保存到 `secrets/prod-supabase.cer`，然后使用：

```env
DATABASE_URL=postgresql://postgres.PROJECT_REF:URL_ENCODED_PASSWORD@aws-0-REGION.pooler.supabase.com:5432/postgres?sslmode=verify-full&sslrootcert=/app/secrets/prod-supabase.cer
```

### 5.4 迁移机制

迁移执行器维护 `xarchiver_schema_migrations` 表：

```text
new SQL file       -> applied once and recorded with checksum
known SQL file     -> skipped
changed known file -> refused; add a new numbered migration instead
```

迁移脚本位于 [`sql/`](../../sql/)，按编号顺序应用（`001_init.sql` … `009_worker_lease.sql`）。新增 schema 变更时**追加一个新的编号迁移**，不要修改已应用的旧脚本——执行器会因校验和不一致而拒绝。镜像启动时自动运行；也可手动 `... run --rm app db migrate`。

### 5.5 验证新数据库

接入真实数据前，先用可丢弃的库验证：

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml run --rm app db migrate
docker compose --env-file .env.production -f docker-compose.prod.yml run --rm app status
```

然后在 SQL Editor 中检查迁移历史与状态分布（见 [`read-only-queries.sql`](./read-only-queries.sql)）：

```sql
select filename, applied_at from xarchiver_schema_migrations order by filename;
select download_status, count(*) from tweets group by download_status order by download_status;
```

---

## 6. 从源码运行（开发路径）

镜像部署之外，仓库自带 dev 风格的 [`docker-compose.yml`](../../docker-compose.yml)：它从 `./cli` 构建镜像、把源码 bind-mount 进容器，并附带本地 Postgres。适合开发与调试，不建议直接用于生产。

```bash
docker compose build xarchiver
docker compose run --rm xarchiver init /app/archive
docker compose up -d postgres
docker compose run --rm --service-ports xarchiver serve
```

dev 镜像基于 `python:3.12-slim`，内置 `ffmpeg`、`gallery-dl`、`yt-dlp`（见 [`cli/Dockerfile`](../../cli/Dockerfile) 与 [`cli/requirements.txt`](../../cli/requirements.txt)）。这条路径下 WebUI 需单独构建并 serve（见第 7 节），不与后端同源。

一次性 CLI 操作（指向外部库时加 `--no-deps` 避免连带启动本地 Postgres）：

```bash
docker compose run --rm --no-deps xarchiver status
docker compose run --rm --no-deps xarchiver verify --full
docker compose run --rm --no-deps xarchiver export --format csv --status all
```

媒体文件落盘结构（两条路径一致）：

```text
archive/media/<author_id>/<tweet_id>/<tweet_id>--p<media_index>.<ext>
archive/exports/   CSV / HTML 图库导出
archive/state/     下载器状态与运行时 cookie 副本
```

主目录名使用稳定的 `author_id`；用户名保存在 Postgres 元数据中用于搜索与展示。来源扫描与下载的业务边界见 [../source-scanning-workflow.md](../source-scanning-workflow.md)。

---

## 7. WebUI 构建与契约校验

生产镜像已在构建阶段（`node:22` stage）打包好 WebUI 并同源 serve，**部署时无需手工构建**。本节面向开发与发布镜像前的本地校验。

### 7.1 本地开发

```bash
cd webui
npm install
npm run dev      # http://127.0.0.1:5173，dev proxy 转发 /api 到 127.0.0.1:8000
```

### 7.2 生产构建（镜像内自动执行）

```bash
cd webui
npm run build    # tsc --noEmit && vite build，产物在 webui/dist/
```

前端默认走相对路径（`API_BASE_URL` 为空），因此构建产物可直接同源托管，无需配置 API 地址。

### 7.3 API 契约校验

后端 schema 与前端类型可能漂移。CI 通过 [`scripts/check_api_contract.sh`](../../scripts/check_api_contract.sh)（workflow [`api-contract.yml`](../../.github/workflows/api-contract.yml)）校验：重新生成 `generated.ts` 并 diff 仓库内版本，不一致即失败。修复方式：

```bash
cd webui && npm run generate:api-types   # 需 Docker 起后端；然后提交更新后的 generated.ts
```

镜像构建依赖已提交的 `generated.ts`，因此构建 WebUI 不需要后端在线。

---

## 8. 运行参数与调优

所有参数通过环境变量配置（compose 透传 `.env.production`，缺省时用代码内默认值）。

### 8.1 数据库与服务

```env
DATABASE_URL=...            # Postgres 连接串
ARCHIVE_DIR=/app/archive    # 容器内归档根目录
COOKIE_FILE=/app/secrets/cookies.txt
API_PORT=8000               # 发布端口；容器内 API_HOST 固定为 0.0.0.0
```

### 8.2 下载与重试

```env
DEFAULT_DOWNLOAD_ENGINE=gallery-dl
RETRY_LIMIT=3
RETRY_BACKOFF_MINUTES=15
STUCK_TIMEOUT_MINUTES=120
QUEUE_BATCH_SIZE=20            # API worker 每轮领取的 queued tweet 数
DOWNLOADER_SLEEP_MIN_SECONDS=2 # 透传给 gallery-dl / yt-dlp，避免紧密连续请求
DOWNLOADER_SLEEP_MAX_SECONDS=6
```

### 8.3 来源扫描（与下载独立）

```env
SOURCE_SCAN_BATCH_SIZE=20         # native cursor 模式下每批目标 Tweet 窗口
SOURCE_SCAN_SLEEP_MIN_SECONDS=20
SOURCE_SCAN_SLEEP_MAX_SECONDS=45
```

`SOURCE_SCAN_*` 只影响来源发现，不影响下载队列。调高 sleep 区间可降低触发 X/Twitter 限流的风险，代价是吞吐下降。

---

## 9. 备份与恢复

归档系统有两类彼此独立的备份面（见第 1 节）。**仅恢复数据库备份，无法找回本地媒体文件。**

### 9.1 大规模归档前

1. 将 `archive/media/` 和 `archive/state/` 备份到独立磁盘或其他位置。
2. 执行迁移或批量修改元数据前，先创建数据库逻辑导出。
3. 不要把 `secrets/cookies.txt`、数据库密码和证书放进会被共享的备份位置。

### 9.2 数据库逻辑备份

随镜像附带的 Postgres 可直接用 `pg_dump`（经 compose 在 postgres 容器内执行）：

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml exec postgres \
  pg_dump -U xarchiver xarchiver > backup-$(date +%F).sql
```

外部 Supabase 库则从 **Connect** 面板取 Direct 或 Session pooler 连接串（**不要用 Transaction pooler**），用 Supabase CLI：

```bash
supabase db dump --db-url "$DATABASE_URL" -f roles.sql --role-only
supabase db dump --db-url "$DATABASE_URL" -f schema.sql
supabase db dump --db-url "$DATABASE_URL" -f data.sql --use-copy --data-only
```

将导出文件保存在仓库之外，并附上备份日期与项目标识。

### 9.3 恢复演练

先把备份恢复到一个新的、可丢弃的库中演练：

```bash
psql "$RESTORE_DATABASE_URL" -f schema.sql
psql "$RESTORE_DATABASE_URL" -f data.sql
```

然后校验：

```sql
select count(*) as tweets from tweets;
select count(*) as media_assets from media_assets;
select download_status, count(*) from tweets group by download_status order by download_status;
select filename, checksum from xarchiver_schema_migrations order by filename;
```

挂载一份本地 `archive/` 备份副本并运行（不要指向唯一的那份媒体数据）：

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml run --rm app verify
docker compose --env-file .env.production -f docker-compose.prod.yml run --rm app export --format csv --status all
```

### 9.4 恢复检查清单

- 数据库表和迁移历史都已恢复到位。
- 推文和媒体记录数量与备份前导出结果大致相符。
- 本地媒体备份已单独恢复。
- `verify` 输出的 verified/missing/corrupt 状态符合预期。
- 恢复出的项目提升为正式环境后，数据库密码及所有自定义角色密码已重置。

---

## 10. 运维与监控

### 10.1 健康检查

```text
GET /health               基础存活检查（镜像 HEALTHCHECK 即用此端点）
GET /api/v1/health/detail 详情，含 db_pool（active / idle / waiting）等
```

数据库连接由 `psycopg_pool` 连接池管理（`min_size=2, max_size=10`）。连接被中断时连接池会自动重建，不会级联失败。compose 中 `app` 与 `postgres` 均设 `restart: unless-stopped`。

### 10.2 后台 worker 与崩溃恢复

`serve` 在进程内拉起两个 daemon：归档队列 worker 与来源扫描 worker。两者用持久化 lease + 心跳续约（[`sql/009_worker_lease.sql`](../../sql/009_worker_lease.sql)）防止进程崩溃后任务永久卡死——重启后过期 lease 的行会被新 worker 重新认领。若仍有遗留卡住的任务：

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml run --rm app recover-interrupted
docker compose --env-file .env.production -f docker-compose.prod.yml run --rm app requeue
```

### 10.3 写操作并发

写动作由进程内锁串行化。已有写动作运行时，写 API 返回 `409 write_action_in_progress`，重试即可。

### 10.4 状态规则（用于排查）

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

排查失败项可用 [`read-only-queries.sql`](./read-only-queries.sql) 中的查询，或 `app export-failures`。

### 10.5 CI 与测试隔离

CI 会构建后端镜像、在重置后的测试库上跑后端测试，并在 `webui/` 与 `extension/` 执行 `npm run check`，外加 API 契约校验。详见 [../engineering-ci-and-test-isolation.md](../engineering-ci-and-test-isolation.md)。

> 重要：不要在 CI 中提供真实 X/Twitter cookies。测试必须使用 mock、fixture 或本地文件。

---

## 11. 安全清单

部署前与提升为生产前逐项确认：

- [ ] `secrets/cookies.txt` 为 Netscape 格式，且未被提交。
- [ ] `.env.production` 未被提交；`POSTGRES_PASSWORD` 已改强密码且与 `DATABASE_URL` 一致，特殊字符已 URL 编码。
- [ ] 外部库连接串使用 Direct 或 Session pooler，迁移/备份未走 Transaction pooler（端口 6543）。
- [ ] 如启用 `verify-full`，根证书放在 `secrets/prod-supabase.cer` 且未提交。
- [ ] API 端口未直接暴露公网；远程访问经过带鉴权的反向代理或隧道。
- [ ] 数据库逻辑备份保存在仓库之外，本地 `archive/` 已单独备份。
- [ ] 恢复演练在可丢弃库上完成，未指向唯一的媒体数据副本。
- [ ] 发布镜像所需的 Docker Hub secrets（如使用）已在仓库配置。

---

## 12. 参考资料

- Supabase 连接：<https://supabase.com/docs/guides/database/connecting-to-postgres>
- SSL 强制：<https://supabase.com/docs/guides/platform/ssl-enforcement>
- 备份恢复：<https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore/>
- 平台备份：<https://supabase.com/docs/guides/platform/backups>
