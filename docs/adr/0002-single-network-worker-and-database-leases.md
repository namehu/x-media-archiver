# 单网络 worker 与数据库租约

## Status

Accepted

## Context

后台历史/计划扫描和 archive queue 下载都会启动 gallery-dl 或 yt-dlp 并访问 X/Twitter。若让这两类后台工作各自由独立 worker 并发执行，会放大账号限流、Cookie 失效和子进程回收的复杂度。另一方面，下载和扫描可能运行数分钟，应用重启后不能依赖进程内队列恢复所有权。

系统当前目标是单管理员、单应用实例的本地部署，不需要为了理论吞吐量提前引入 RabbitMQ、Redis 或多 worker 调度器。

## Decision

- FastAPI lifespan 启动一个 `archive-network-worker`，统一调度后台历史/计划扫描和 archive queue 下载。
- 两类后台任务同时就绪时严格交替；下载 run 按 `last_dispatched_at` 轮转。
- Postgres 是任务队列。领取使用 `FOR UPDATE SKIP LOCKED`，并写入 `worker_id`、`claimed_at` 和 `lease_expires_at`。
- owner 通过 heartbeat 续租；archive item 终态回写校验 `worker_id`，丢失 lease 后旧 owner 不提交 item 终态。已经执行中的下载、媒体回填和校验不受完整 fencing token 保护，可能在显式 lease 检查前产生文件或事实写，后续依靠幂等 upsert 与 verify 收敛。
- 应用启动时在新 worker 运行前统计过期 archive item lease；后续领取查询负责原子接管。遗留活动扫描会在启动阶段收敛并关闭日志流，过期扫描 lease 会被清理。
- 外部子进程以进程组管理，Compose 使用 `init: true` 回收孤儿进程。

## Consequences

- 后台队列产生的 X/Twitter 网络压力、限流和 Cookie 使用行为更加可预测。
- 页面关闭和应用短暂重启不会丢失持久任务；过期 archive item 可在后续领取时被接管。
- 后台吞吐受一个网络 owner 限制，这是当前部署目标下的主动取舍。
- 即时扫描 API、Cookie 检测以及直接执行的 CLI `sources scan`、`download`、`retry` 是绕过该 worker 的运维旁路，可能与后台任务并发；Cookie 检测的独立进程内锁也不会阻止扫描或下载。使用者需自行避免并行执行。若要强制覆盖所有入口，必须增加跨入口、跨进程的所有权机制。
- 进程内作用域锁和 EventBroker 仍不能支持多个主动应用实例。需要横向扩展时，必须先设计跨实例所有权、锁与 pub/sub，不能只增加容器副本。

详细机制见 [可靠性与一致性设计](../architecture/reliability-and-consistency.md)。
