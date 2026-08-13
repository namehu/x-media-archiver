# 架构决策记录索引

ADR 用来记录难以仅从代码理解、且会约束后续演进的重要工程决策。状态采用 `Proposed`、`Accepted`、`Superseded` 或 `Deprecated`。

| ADR | 状态 | 决策摘要 |
| --- | --- | --- |
| [0001：持久化来源批量任务](0001-persist-source-bulk-tasks.md) | Accepted | 批量任务、逐来源 item 和计划策略持久化到 Postgres，由单网络 worker 统一编排 |
| [0002：单网络 worker 与数据库租约](0002-single-network-worker-and-database-leases.md) | Accepted | 后台历史/计划扫描与队列下载共享一个网络 owner；Postgres 队列、租约和 heartbeat 提供恢复语义 |
| [0003：Postgres 与本地文件系统双事实边界](0003-postgres-and-local-filesystem-boundary.md) | Accepted | Postgres 保存业务状态，本地 `archive/` 保存媒体与日志正文，备份和恢复必须覆盖两者 |
| [0004：只读运行态投影](0004-read-only-runtime-projection.md) | Accepted | WebSocket 仅推送有界运行态，数据库与 REST 仍是最终事实，断线通过 snapshot 收敛 |

## 新增 ADR 的条件

以下变化不应只更新实现，需要新增 ADR：

- 从单应用实例升级为多实例或分布式 worker。
- 引入外部消息队列、对象存储或跨进程事件总线。
- 改变数据库队列、租约、重试或写锁模型。
- 改变 Postgres 与 `archive/` 的数据所有权或备份边界。
- 把 Runtime WebSocket 从只读投影升级为写命令通道。
- 引入多用户、租户隔离或新的凭据管理模型。

ADR 描述“为什么选择”；[架构文档](../architecture/README.md)描述“系统现在如何工作”。
