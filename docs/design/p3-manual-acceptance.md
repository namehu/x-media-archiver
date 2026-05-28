# P3 手工验收清单

> 目的：把 P3 后的人工验证步骤固定下来，避免每次改动后只凭感觉判断。

## 验收边界

本清单用于本地 API + WebUI 联动验证。默认不对真实 X 账号执行大批量扫描或下载；涉及真实来源时，只做小批量受控验证。

启动方式：

```bash
docker-compose run --rm --service-ports xarchiver serve
cd webui
npm run dev
```

WebUI 地址：

```text
http://127.0.0.1:5173
```

API 地址：

```text
http://127.0.0.1:8000
```

## API 基础

- [ ] `GET /health` 返回正常。
- [ ] `GET /api/v1/health/detail` 返回 worker、queue、sources、recent_errors。
- [ ] `GET /openapi.json` 可访问。
- [ ] OpenAPI 中业务路径只使用 `/api/v1/*`。
- [ ] 旧 `/api/*` 业务路由不可用，例如 `/api/summary`、`/api/archive-runs`、`/api/sources`。
- [ ] `GET /api/v1/events?topics=archive_runs,sources,source_scans` 能建立 SSE 连接。

## Dashboard

- [ ] 页面可以加载摘要统计。
- [ ] API 失败时显示错误状态，而不是空白页面。
- [ ] SSE 状态在顶部可见：连接中、已连接、离线轮询。
- [ ] 顶部健康状态可见：写操作、队列、扫描、错误计数。

## Archive Queue

- [ ] 可以提交少量 tweet URL。
- [ ] 提交后创建新 Run，并能看到 queued / running / succeeded / failed 等状态变化。
- [ ] Run 详情可展开或加载，能看到 item 级结果。
- [ ] 状态筛选、失败筛选、tweet_id 查询有效。
- [ ] 分页按钮不会跳页错乱。
- [ ] Retry failed items 会创建新的可审计 Run。
- [ ] 运行中页面能通过 SSE 或兜底轮询刷新。

## Sources

- [ ] 可以新增来源，输入 `https://x.com/<user>` 或 `https://x.com/<user>/media`。
- [ ] 来源类型和扫描目标语义符合当前规则：主页扫描普通时间线，媒体页优先扫描含媒体 Tweet。
- [ ] 手工下一批扫描会生成 `source_scan_runs` 记录。
- [ ] 后台历史扫描启动后，页面能看到正在执行或最近执行状态。
- [ ] 停止历史扫描后，不再继续发起新批次；已在途批次完成后会落库审计记录。
- [ ] 扫描结果只进入 discovered 记录，不自动提交下载队列。
- [ ] 提交 discovered 到队列是显式动作，并可限制提交数量。
- [ ] 来源列表筛选、分页正常。
- [ ] 来源详情中最近扫描记录、发现数量、新增数量、重复数量、媒体预估数量可读。

## Library

- [ ] 媒体列表分页正常。
- [ ] 基础筛选正常。
- [ ] 媒体预览 URL 使用 `/api/v1/media-file/{relative_path}`。
- [ ] 点击 Tweet detail 后可看到 Tweet 文本、作者、媒体数量、媒体类型和文件列表。

## Failures

- [ ] 失败列表分页正常。
- [ ] 错误分类和错误摘要可读。
- [ ] 大量失败记录时页面不会一次性加载全部数据。

## Duplicates

- [ ] 重复媒体分页正常。
- [ ] 当前页 rows 和全局 duplicate group 统计语义清楚。
- [ ] 同一 sha256 下的重复项可用于定位文件和 Tweet。

## Operations / Maintenance

- [ ] Requeue、Recover interrupted、Export 是显式操作。
- [ ] Full backfill 和 Full verify 保留显式确认语义。
- [ ] WebUI 不提供媒体文件删除能力。
- [ ] 后端写操作互斥：已有写操作执行时，新写操作返回 `409 write_action_in_progress`。

## OpenAPI / WebUI 类型

- [ ] 后端 schema 变更后执行 `npm run generate:api-types`，确认 `webui/src/api/generated.ts` 同步更新；OpenAPI JSON 是被忽略的本地临时产物。
- [ ] 页面 API 请求仍集中通过 `webui/src/lib/api.ts` 或其兼容导出入口。
- [ ] 新增用户可见文案同时补充 `webui/src/locales/zh.ts` 与 `webui/src/locales/en.ts`。

## 建议验证命令

轻量检查：

```bash
git diff --check
```

完整后端验证：

```bash
docker-compose run --rm --entrypoint python xarchiver -m unittest discover -s /app/tests
```

完整 WebUI 验证：

```bash
cd webui
npm run generate:api-types
npm run check
```

## 不作为默认验收的动作

- 不默认跑真实 X 大批量历史扫描。
- 不默认跑真实大批量下载。
- 不默认删除 `archive/` 下媒体文件。
- 不默认重置数据库，除非本轮验证明确需要空库。
