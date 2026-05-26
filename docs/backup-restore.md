# 备份与恢复操作手册

最后更新：2026-05-26

归档系统有两类彼此独立的备份面：

```text
Supabase Postgres -> tweet, media, job, and attempt metadata
local archive/     -> downloaded images/videos, downloader state, and generated exports
```

仅恢复数据库备份，无法找回本地媒体文件。

## 大规模归档前

1. 将 `archive/media/` 和 `archive/state/` 备份到独立的本地磁盘或其他备份位置。
2. 在执行迁移或批量修改元数据之前，先创建数据库逻辑导出。
3. 不要把 `secrets/cookies.txt`、数据库密码和证书放进会被共享的备份位置。

## 数据库逻辑备份

从 Supabase 的 **Connect** 面板获取 Direct 或 Session pooler 的连接串。执行导出时不要
使用 Transaction pooler。

使用 Supabase CLI：

```bash
supabase db dump --db-url "$DATABASE_URL" -f roles.sql --role-only
supabase db dump --db-url "$DATABASE_URL" -f schema.sql
supabase db dump --db-url "$DATABASE_URL" -f data.sql --use-copy --data-only
```

将这些文件保存在仓库之外，并附上备份日期和项目标识。Supabase 控制台提供的备份可以作为
额外的恢复手段；但在应用迁移之前，本地生成的逻辑导出仍然非常有价值。

## 恢复演练

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

## 恢复检查清单

- 数据库表和迁移历史都已恢复到位。
- 推文和媒体记录数量与备份前导出的结果相比大致合理。
- 本地媒体备份已单独恢复。
- `verify` 输出的 verified/missing/corrupt 状态符合预期。
- 恢复出的项目提升为正式环境后，数据库密码以及所有自定义角色密码都已重置。

## 官方参考资料

- <https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore/>
- <https://supabase.com/docs/guides/platform/backups>
