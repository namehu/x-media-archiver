# Supabase Postgres 部署指南

最后更新：2026-05-26

本项目将元数据存储在 Postgres 中，并将下载的媒体文件保存在本地磁盘。因此，可以使用
Supabase 数据库替代本地 Docker Postgres 服务，而无需改变归档目录或下载流程。

## 连接方式选择

请使用 Supabase 项目控制台 **Connect** 面板中的连接串。

| 操作 | 推荐连接方式 |
| --- | --- |
| 在具备 IPv6 的持久环境中运行 CLI | Direct connection，端口 `5432` |
| 在仅支持 IPv4 的网络中运行 CLI | Supavisor Session pooler，端口 `5432` |
| 执行迁移、`pg_dump` 或恢复 | 优先使用 Direct connection；不可用时使用 Session pooler |

执行迁移或备份恢复操作时，不要使用端口 `6543` 的 Transaction pooler。

## 准备密钥配置

在仓库根目录创建一个不纳入版本控制的 `.env.production` 文件：

```env
DATABASE_URL=postgresql://postgres.PROJECT_REF:URL_ENCODED_PASSWORD@aws-0-REGION.pooler.supabase.com:5432/postgres?sslmode=require
ARCHIVE_DIR=/app/archive
COOKIE_FILE=/app/secrets/cookies.txt
DEFAULT_DOWNLOAD_ENGINE=gallery-dl
RETRY_LIMIT=3
```

如果希望使用更严格的服务端身份校验，请从 Supabase 控制台下载服务器根证书，保存到
`secrets/prod-supabase.cer`，然后使用：

```env
DATABASE_URL=postgresql://postgres.PROJECT_REF:URL_ENCODED_PASSWORD@aws-0-REGION.pooler.supabase.com:5432/postgres?sslmode=verify-full&sslrootcert=/app/secrets/prod-supabase.cer
```

不要把数据库密码、证书文件和 X 的 cookies 提交到 Git 中。如果密码包含 `@`、`#`、`/`
或 `:` 等字符，请先进行 URL 编码，再写入 URI。

## 运行迁移

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

对于已有的 V0 数据库，首次启用迁移跟踪后会重新执行 `001_init.sql`。由于该脚本使用了
`if not exists`，因此可以安全重跑，随后系统会记录其校验和。

## 验证新数据库

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

## 只读检查

常用检查查询见 [`read-only-queries.sql`](./read-only-queries.sql)。
这些查询只会读取应用表，可以直接粘贴到 Supabase SQL Editor 中执行，也可以作为后续
构建仪表盘的基础。

## 官方参考资料

- <https://supabase.com/docs/guides/database/connecting-to-postgres>
- <https://supabase.com/docs/guides/platform/ssl-enforcement>
- <https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore/>
