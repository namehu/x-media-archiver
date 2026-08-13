# Postgres 与本地文件系统双事实边界

## Status

Accepted

## Context

媒体文件和长时间运行的外部工具日志体积大，不适合直接存入 Postgres；但仅靠目录结构又无法可靠表达任务状态、重试、来源关系、检索、整理和审计。系统还必须支持精确物理删除、文件校验和数据库快照查询。

## Decision

- Postgres 保存 Tweet、媒体元数据与校验状态、来源、任务、整理关系、检索投影和审计。
- `archive/media` 保存媒体、下载器元数据和派生预览；`archive/logs` 保存追加式 JSONL 操作日志；`archive/state` 保存必要运行状态与临时 Cookie 副本；`archive/exports` 保存可重建导出物。
- `media_assets.local_path` / `metadata_path` 的现有记录可能是绝对路径或相对路径；对外媒体读取会转换为归档相对路径，物理删除则兼容两种格式并验证目标位于 `archive/media`。`operation_log_streams.log_path` 保存服务端生成的归档相对路径，读取时验证目标仍位于 `archive/`。
- 文件校验结果回写数据库，但数据库状态不能替代文件字节本身。
- 媒体删除按 `media_assets.id` 精确解析文件集合，以 `operation_id` 提供幂等审计；不使用目录通配或隐式递归删除。可捕获的文件错误会提交 `failed` 与部分统计；若进程在删文件后、数据库提交前崩溃，则可能没有持久 `running` 记录，需要用原 `operation_id` 重试，或通过 `verify` 和人工处置收敛。
- 完整恢复业务状态与媒体的必需集合是 Postgres 和 `archive/media/`。`archive/logs/`、`archive/raw/` 是可选诊断与输入历史；`archive/state/` 仅在需要延续下载器状态时备份，其中的 Cookie 副本必须按凭据保护；`archive/exports/` 可重建。

## Consequences

- 数据库查询保持轻量，媒体和日志可以使用文件系统顺序 I/O。
- 跨数据库与文件系统的动作不存在通用原子事务。幂等与审计可以处理已完成和可捕获失败，但进程在文件变更后、数据库提交前崩溃仍需重试、校验或人工处置。
- 只恢复数据库会得到缺失媒体；只恢复文件会丢失队列、关系、索引和审计。运维文档必须把 Postgres 与 `archive/media/` 作为必需恢复集合，并明确其他目录的保留等级。
- 未来迁移对象存储时，需要重新定义路径、删除幂等和一致性检查，不能只替换 `Path` 调用。

数据布局见 [核心数据模型](../architecture/data-model.md)，运维步骤见 [部署与备份恢复](../deploy/README.md)。
