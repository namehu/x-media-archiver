# 只读运行态投影

## Status

Accepted

## Context

下载进度、当前扫描和连接状态需要低延迟展示，但完整列表、分页、历史和恢复仍由数据库提供。若让 WebSocket 成为第二套业务状态或直接承载写命令，会把连接生命周期、命令幂等和数据库状态混在一起，并使断线恢复变得脆弱。

## Decision

- Postgres 是持久事实源，REST 提供分页快照和全部写入口。
- Runtime WebSocket v1 只发送 snapshot、patch、invalidate、heartbeat 和 resync 信号，不接收业务命令。
- EventBroker 是进程内有界通道，不提供持久 replay；消息携带进程 epoch、全局 sequence 和连接局部 sequence。
- 连接首帧和周期性发送持久事实 snapshot；队列溢出、epoch 变化或序列不连续时重新快照。
- WebUI 用 Zustand 保存 active/recent overlay，用 React Query 保存 REST 资源；终态事件触发 query invalidation。
- WebSocket 不可用时回退 `/api/v1/runtime/snapshot` 轮询，任意时刻只允许一种 transport 写 Runtime Store。
- SSE 保留为兼容事件端点，但不再驱动根级 Runtime Store。

## Consequences

- 实时消息允许丢失、重复或合并，业务正确性不依赖连接持续存在。
- 刷新页面或应用重启后可以从数据库 snapshot 重建 UI。
- v1 不能通过 WebSocket 暂停、恢复或提交任务；这些动作继续使用 REST。
- 如果未来增加写命令，必须另行设计 command ID、幂等、授权、接受回执和业务终态的区别，并新增 ADR。

详细协议见 [WebUI 实时运行态](../architecture/runtime-realtime-evolution.md)。
