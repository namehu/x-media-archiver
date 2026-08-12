# 手工验收与测试清单

> 目的：固定手工验证步骤，避免每次改动后只凭感觉判断。本清单包含本地 API + WebUI 联动验证，以及核心的来源扫描验收标准。

## 1. 验收边界与启动方式

本清单用于本地 API + WebUI 联动验证。默认不对真实 X 账号执行大批量扫描或下载；涉及真实来源时，只做小批量受控验证。

启动方式：

```bash
docker-compose run --rm --service-ports xarchiver serve
cd webui
npm run dev
```

WebUI 地址：`http://127.0.0.1:5173`
API 地址：`http://127.0.0.1:18000`

## 2. 建议验证命令

轻量检查：

```bash
git diff --check
```

完整后端验证：

```bash
bash scripts/lint_python.sh
docker-compose run --rm --entrypoint python xarchiver -m unittest discover -s /app/tests
```

完整 WebUI 验证：

```bash
cd webui
npm run generate:api-types
npm run check
```

## 3. 不作为默认验收的动作

- 不默认跑真实 X 大批量历史扫描。
- 不默认跑真实大批量下载。
- 不默认删除 `archive/` 下媒体文件。
- 不默认重置数据库，除非本轮验证明确需要空库。

## 4. API 基础

- [ ] `GET /health` 返回正常。
- [ ] `GET /api/v1/health/detail` 返回 worker、queue、sources、recent_errors。
- [ ] `GET /openapi.json` 可访问。
- [ ] OpenAPI 中业务路径只使用 `/api/v1/*`。
- [ ] 旧 `/api/*` 业务路由不可用，例如 `/api/summary`、`/api/archive-runs`、`/api/sources`。
- [ ] `GET /api/v1/events?topics=archive_runs,sources,source_scans` 能建立 SSE 连接。

## 5. WebUI 界面联动

### Dashboard
- [ ] 页面可以加载摘要统计。
- [ ] 页面只展示 API 返回的真实快照和状态分布，不根据当前总数生成伪造趋势或“24h 活动”。
- [ ] API 失败时显示错误状态，而不是空白页面。
- [ ] SSE 状态在顶部可见：连接中、已连接、离线轮询。
- [ ] 顶部健康状态可见：写操作、队列、扫描、错误计数。

### Archive Queue
- [ ] 可以提交少量 tweet URL。
- [ ] 提交后创建新 Run，并能看到 queued / running / succeeded / failed 等状态变化。
- [ ] Run 详情可展开或加载，能看到 item 级结果。
- [ ] 状态筛选、失败筛选、tweet_id 查询有效。
- [ ] 分页按钮不会跳页错乱。
- [ ] Retry failed items 会创建新的可审计 Run。
- [ ] 运行中页面能通过 SSE 或兜底轮询刷新。

### Sources
- [ ] 可以新增来源，输入 `https://x.com/<user>` 或 `https://x.com/<user>/media`。
- [ ] 来源类型和扫描目标语义符合当前规则：主页扫描普通时间线，媒体页优先扫描含媒体 Tweet。
- [ ] 手工下一批扫描会生成 `source_scan_runs` 记录。
- [ ] 后台历史扫描启动后，页面能看到正在执行或最近执行状态。
- [ ] 停止历史扫描后，不再继续发起新批次；已在途批次完成后会落库审计记录。
- [ ] 普通单来源扫描结果只进入 discovered 记录，不隐式提交下载队列。
- [ ] 提交 discovered 到队列是显式动作，并可限制提交数量。
- [ ] 来源列表筛选、分页正常。
- [ ] 列表可逐项勾选或选择最多 200 个“当前筛选全部”，超过上限时明确提示缩小筛选；已删除来源不可选择。
- [ ] 列表能区分最新 Tweet 发布时间、最近成功同步，并展示未提交/排队/处理中/失败下载数、任务状态和下次执行。
- [ ] “更新最新推文”“下载当前缺失项”“更新并下载本轮新增”都会创建持久化父任务，关闭任务面板后仍继续。
- [ ] 组合任务只下载其关联扫描运行首次发现的 Tweet，不把历史待下载积压混入本轮新增。
- [ ] 任务中心可查看逐来源成功/跳过/失败原因，并能暂停、恢复、取消和仅重试失败来源；暂停父任务会暂停其下载 run。
- [ ] 重试定时任务仍遵守每来源 50、每任务 1000 的下载上限；重试人工缺失下载超过 500 条时再次弹出确认。
- [ ] 同一 Tweet 先失败、后续重新下载成功后，Sources 列表失败积压与异常筛选不再保留旧失败。
- [ ] 定时策略默认关闭，可按间隔/每日/每周创建；错过或重叠执行合并，下载上限和认证熔断可见。
- [ ] 两个以上来源下载 run 同时排队时会轮转取得进度；扫描和下载同时就绪时不会并发启动外部网络子进程。
- [ ] 来源详情中最近扫描记录、发现数量、新增数量、重复数量、媒体预估数量可读。

### Search, Library, Failures, Duplicates

- [ ] Search 默认只展示已校验 Tweet；关键词可命中正文、作者、标签、合集和私人备注，拼写近似与中文子串可返回结果。
- [ ] Search 的关键词、来源、日期、媒体类型、归档状态、标签、合集、排序和分页均同步到 URL，刷新后保持。
- [ ] Search 结果正文高亮，桌面筛选栏与窄屏筛选 Sheet 均可操作；加载、空和错误状态没有旧结果误导。
- [ ] Search 结果复用帖子卡片和全屏媒体预览，Tweet 详情链接可达。
- [ ] 媒体列表分页、基础筛选正常。媒体预览 URL 使用 `/api/v1/media-file/{relative_path}`。点击 Tweet detail 后可看到元数据和文件列表。
- [ ] 失败列表分页正常。错误分类和错误摘要可读。大量记录时不会一次性加载全部数据。
- [ ] Failures 默认只显示待处理项；待处理、已忽略、全部切换及状态、错误分类、搜索、排序会同步到 URL，汇总数字不受当前页大小影响。
- [ ] 当前页最多选择 100 项；批量忽略可填写预设原因和备注，重复操作或状态已变化时返回部分成功与跳过原因。
- [ ] 忽略会取消未开始的旧任务并阻止普通来源重复提交，恢复只回到待处理列表且不自动下载；手动重试创建新的 `manual_retry` Run，并可从处置记录跳转查看。
- [ ] 单条和批量操作后列表、Dashboard 待处理失败数、错误分布及时刷新；失败 CSV 包含 disposition、忽略原因/备注和最新处置字段。
- [ ] 失败项离开失败状态后当前忽略标记自动清除，但历史处置事件仍可查询；之后再次失败会作为新的待处理项出现。
- [ ] 重复媒体分页正常。当前页 rows 和全局 duplicate group 统计语义清楚。

### Operations / Maintenance
- [ ] Requeue、Recover interrupted、Export 是显式操作。
- [ ] 系统状态面板能显示写操作锁、队列积压、来源扫描、最近批次、最近扫描和最近错误。
- [ ] 最近错误中的链接可正常跳转。
- [ ] Full backfill 和 Full verify 保留显式确认语义。
- [ ] Feed、Library 和 Duplicates 的媒体删除均按明确选择的 `media_assets.id` 执行，限制在 `archive/media`，要求二次确认并保留 Tweet、任务历史和删除审计。
- [ ] 后端写操作按作用域互斥：同一来源冲突，或全局维护动作与任一 scoped 写操作冲突时返回 `409 write_action_in_progress`；不同来源的 scoped 操作可以并行。

### OpenAPI / WebUI 类型
- [ ] 后端 schema 变更后执行 `npm run generate:api-types`，确认 `webui/src/api/generated.ts` 同步更新；OpenAPI JSON 是被忽略的本地临时产物。
- [ ] 页面 API 请求仍集中通过 `webui/src/lib/api.ts` 或其兼容导出入口。

## 6. 来源扫描专项验收与核心结论

> 以下内容提取自 2026-05-27 `earthcurated/media` 受控验证记录。在修改扫描相关逻辑时，必须满足以下硬性结论。

### 已确认的核心行为
1. **范围理解**：媒体页的 `--range` 以媒体项计数，不以 Tweet 计数。一批 20 个媒体项发现少于 20 条 Tweet 属于正常结果。
2. **正确落库**：媒体页解析必须仅落库**至少含一个当前批媒体事件**的 Tweet。范围外页面元数据不得被错误落库。
3. **补扫与 Checkpoint**：从最新补扫只更新发现结果和扫描审计，**不得改变历史 checkpoint**（不推进历史 cursor，不因空批而将历史扫描标记完成）。
4. **竞态处理**：停止与在途批次之间存在竞态，批次完成只将扫描进度字段合并进最新 `cursor_state`，不得覆盖新的停止状态。

### 原生 Cursor 接入标准
- 深层数字范围由于耗时过长，已废弃作为真实分页 checkpoint 的方案。
- 来源扫描必须基于原生 cursor (`extractor_cursor`) 推进：
  ```text
  gallery-dl --post-range 1-<batch> -o limit=<batch> [-o cursor=<saved-cursor>]
  ```
- **验收准则**：
  - [ ] 用 profile /timeline 验证 native cursor 语义。
  - [ ] 验证到达结尾、停止/恢复和 API 重启后的 cursor 延续。
  - [ ] 后续验收按空库或清理后的新项目状态执行，不再保留旧数字 checkpoint 的兼容分支。

### 2026-08-12 M0 受控验收

使用用户明确授权的 `user_media` 来源和最多 5 条上限，在独立空库与隔离归档目录完成了发现、人工提交、下载、scoped 回填与校验闭环。5 个 Archive Queue item、5 个 Tweet 和 5 个媒体资产最终均为 `verified`；暂停与 API 重启后 continuation cursor 和下一批位置保持不变。真实验收未主动制造限流、认证失败或网络故障；定向测试覆盖限流/认证暂停及网络错误不推进 cursor，其余页面展示和人工恢复继续按本清单手工验收。

完整环境、步骤、结果和遗留项见 [`source-scanning-acceptance.md`](source-scanning-acceptance.md)。
