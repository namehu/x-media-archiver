# 来源扫描与受控下载验收记录

> 状态：M0 核心验收通过
>
> 最近更新：2026-09-16
>
> 边界：真实 X 验收必须由用户明确指定来源、本地 Cookies 和允许下载的数量；默认上限为 5–20 条。

本文用于记录来源扫描、队列提交、下载、回填和校验的真实链路证据。通用操作步骤见 [`manual-acceptance.md`](manual-acceptance.md)，按钮与状态语义见 [`../architecture/source-scanning-workflow.md`](../architecture/source-scanning-workflow.md)。

## 2026-09-16 批次内拆分冲突回归

- 修正同一账号的主页、`/media` 与 `/media?filter=photo` 旧来源在同一批次预览中都被标记为 `ready` 的问题。预览与执行均在任何写入前检查全部目标 URL，所有争用者返回 `blocked` 和 `batch_conflicts`，其中包含目标 URL 与相关旧来源 ID。
- 在独立临时 Postgres 库通过 19 项媒体拆分专项测试；覆盖正反输入顺序下冲突来源均不写入、`--all` 中无冲突来源仍可拆分、重复输入同一 ID 不误报，以及人工选定单一来源后可拆分和幂等重试。
- 修改文件 Ruff 与 `git diff --check` 通过。本轮未重跑全量后端或 WebUI 验收，未访问真实 X 或操作生产数据。

## 2026-09-08 图片/视频独立来源验收

本节使用独立 Postgres 测试容器、合成来源与空临时归档目录；未挂载真实媒体或 cookies，未对 X 发起新的扫描或下载请求，未对生产数据库执行迁移或拆分。

| 检查 | 结果 |
| --- | --- |
| Alembic 001–027 空库升级 | 通过；027 仅更新索引与映射表 |
| 后端完整 Ruff 检查 | 通过，使用项目 Docker 镜像及 CI 同一配置与范围 |
| 后端完整 unittest 回归 | 497 项通过 |
| 最终媒体来源专项回归 | 16 项通过；在完整回归后补充了实际筛选落库与三种 session 隔离断言 |
| WebUI TypeScript / Vite build | 通过；仅保留既有大 chunk 提示 |
| OpenAPI 与生成类型 | 已同步 `selectable_count`；来源新类型的请求与查询约束已更新 |
| Playwright 桌面 1440px / 窄屏 390px | 4 项通过；URL 自动识别、类型切换、首次扫描、旧来源只读及批量排除；截图检查无横向溢出 |
| 真实 CLI、API 与 WebUI 联动 | 通过；测试 API 关闭生命周期 worker，验证配置与数据库状态，不运行网络扫描 |

专项覆盖：

- 图片、视频、GIF 和混合 Tweet 的类型选择；各来源实际扫描后只记录匹配 Tweet，混合 Tweet 元数据完整，扫描不隐式下载。
- 过滤后为零且带 continuation cursor 的批次继续；两个来源及 `history`、`latest_refresh`、`from_start` 不借用或覆盖彼此 cursor。
- 旧来源不能新增任务或被定时派发，仍可读取历史与已关联策略；批量筛选的 `selectable_count` 排除旧/已删除来源。
- 默认 dry-run 不写数据；新旧同 URL 可共存；显式拆分生成两个暂停、空 cursor 的来源；旧发现与 cursor 保留；重复执行不重建。
- 活跃扫描、暂停下载、已启用策略和目标 URL 冲突阻止拆分；事务中途失败回滚；有映射时 downgrade 明确拒绝。
- 混合 Tweet 跨来源提交关联已有 active item；全局已 verified 的 Tweet 跳过，不重复入队下载。

真实联动使用 CLI 创建拆分映射后，经浏览器分别启动图片和视频来源会话、核对另一来源状态与 cursor 未变，再停止测试会话。另验证图片来源创建、重复 URL 的 409 中文错误提示，以及软删除旧来源的只读详情。重复 `--apply` 返回 `already_split`，新会话状态不被重置。

覆盖边界：当前实现是 gallery-dl 枚举后的应用层筛选，不是新版网页两个原生分页接口的接入。此前两次单页探测仅证明当时 gallery-dl 的请求行为，不能证明完整历史覆盖；本次未扩大真实账号请求范围。部署、备份与显式数据拆分见 [媒体来源拆分](../deploy/media-source-split.md)。

## 执行环境

| 字段 | 记录 |
| --- | --- |
| 日期 | 2026-08-12 |
| 版本 / commit | `ca5a701` + 当前 M0 工作树改动 |
| 部署方式 | Docker Compose；API、扫描 worker 与下载 worker 均使用隔离配置 |
| 数据库 | 独立空库（运行标识不入文档），已应用 20 个 Alembic revision |
| 归档目录 | git ignored 的隔离目录，与日常归档隔离 |
| 来源类型 | 用户指定的公开 `user_media` 来源 |
| 提交上限 | 用户授权最多 5 条 |
| Cookies 状态 | 本地 Netscape 文件可用；内容未进入日志、文档或版本控制 |

## 阻塞 M1 的核心验收

- [x] native cursor 在不足一批时不会误判完成。
- [x] 只有 extractor 明确结束时才完成；空批但仍有 continuation cursor 时保持未完成。
- [x] 暂停、恢复和 API 重启后从已持久化 checkpoint 继续。
- [x] 停止与在途批次竞态不会覆盖更新后的控制状态。
- [x] 扫描和下载共享同一网络 worker，不并发启动外部网络子进程，并以轮换策略避免饥饿。
- [x] `invalid_url`、`rate_limited`、`auth_required` 与 `upstream_api_error` 会暂停自动历史扫描；`network_error` 不推进 cursor，并进入退避重试调度。
- [x] 普通扫描只写 discovered 记录，不隐式创建下载 run。
- [x] 人工提交 5 条发现记录后，Archive Queue 可追踪对应 run、item 和 attempt。
- [x] 完成项的文件路径符合 `archive/media/<author_id>/<tweet_id>/`。
- [x] 下载管线的 scoped backfill 与 verify 只处理本次 5 条记录，来源、队列、Tweet 和媒体状态一致。

## 并行但不阻塞 M1 的验收

- [ ] 真实手机锁屏与恢复后的 WebSocket/REST 快照收敛。
- [ ] 飞牛 NAS 上的长扫描与 Traefik/应用重启恢复。
- [ ] Postgres 元数据与 `archive/` 媒体双数据面的备份恢复演练。

## 执行记录

### 自动化覆盖

- `test_sources.py` 覆盖 native cursor 完成条件、带 continuation cursor 的空批、latest refresh 不改写历史 checkpoint、停止竞态、暂停/恢复和重启恢复；错误路径明确覆盖限流/认证/上游 API 异常暂停，以及网络错误不推进 cursor。
- `test_api_app.py` 的 17 个定向测试通过，包含来源扫描和归档下载同时就绪时的轮换选择。
- API 启动现在会立即恢复上个进程遗留的 `running` 扫描 run；恢复只结束失联 run，不清空可继续的扫描 session 和 checkpoint。

### 真实受控链路

1. 首次 latest refresh 限制 5 条，发现 5 条、写入 5 条新 discovery，未创建 archive run；返回 continuation cursor，因此结果保持未完成，且未推进历史 checkpoint。
2. 随后启动 history session 并只执行一个 5 条批次。该批命中同一批 Tweet，新增数为 0；continuation cursor 被保存，`next_start_index` 推进至 6，session 保持可继续。
3. 人工提交这 5 条 discovery，创建 1 个 archive run 和 5 个唯一 item；没有重复、阻塞或隐式追加项。
4. 隔离下载 worker 只领取这 5 项。下载进程退出码为 0，5 项全部完成 scoped 回填与校验，run 最终为 `completed`。
5. 数据库核对结果为：5 个 item 全部 `verified`、5 个 Tweet 全部 `verified`、5 个媒体资产全部 `verified`、5 个下载 attempt 全部 `downloaded`。文件均位于隔离归档根下的数字 author ID / Tweet ID 目录。
6. 额外执行显式全量 verify（隔离目录仅含本次样本）：checked 5、verified 5、missing 0、corrupt 0。
7. 保留 checkpoint 后暂停来源，短暂重启 API 再停止。重启期间没有产生新扫描 run；暂停状态、continuation cursor 和 `next_start_index = 6` 均保留。恢复后显式停止 session，来源回到可操作状态，checkpoint 仍未丢失。

### 修正与遗留

- 修正了空记录批次绕过 continuation cursor 完成条件的问题，避免仍有下一页时误标历史扫描完成。
- 修正了 API 启动仅等待 lease 超时才处理上个进程遗留扫描 run 的问题；现在启动即恢复，保留 session checkpoint。
- 修正了 gallery-dl 在 X 时间线 GraphQL 请求返回未归类 4xx / API error 后仍以 0 退出时被误判为空批完成的问题；此类批次现在保留 checkpoint、丢弃不完整输出并记录 `upstream_api_error`。
- 本次真实样本没有故意触发限流、认证失效或网络错误；限流/认证暂停及网络错误不推进 cursor 由可控模拟覆盖。错误信息的全部 WebUI 展示状态和人工恢复流程仍留在对应页面的手工验收清单中。
- 手机锁屏、飞牛 NAS、Traefik/应用重启和完整备份恢复仍属于并行验收项，不阻塞 M1。
- 隔离数据库与 5 个媒体文件暂时保留供复查；清理属于破坏性动作，不在本次验收中自动执行。
