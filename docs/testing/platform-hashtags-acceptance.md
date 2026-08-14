# 平台 Hashtag 验收

> 范围：M5.1 数据模型、gallery-dl 落盘元数据采集、历史维护、搜索与 API 契约，以及 M5.2 WebUI 展示和精确筛选。本文不要求访问真实 X。

## 固定边界

- 唯一事实来源是下载成功后登记在 `media_assets.metadata_path` 的 gallery-dl JSON 文件。
- 不读取来源扫描或 Tweet 的 `raw_import`，不从正文推断，不接收浏览器扩展、API、JSONL 或 yt-dlp Hashtag。
- 关系只增不减：缺失、空数组、非法文件或后来不再出现都不会清理已经观察到的关系。
- 平台 Hashtag 只读且独立于用户可编辑的 `tags` / `tweet_tags`。

## 自动验证

```bash
bash scripts/lint_python.sh
docker-compose run --rm --entrypoint python xarchiver -m unittest discover -s /app/tests
```

定向测试应覆盖：

1. 普通 Tweet、Note Tweet、缺失字段、重复/大小写、非字符串、空白、控制字符和数量/长度上限。
2. Unicode NFKC + casefold 判重，同时保留每条 Tweet 首次显示写法与位置。
3. 下载后采集失败不改变下载结果；yt-dlp 不触发采集。
4. dry-run、apply、重复 apply 的幂等性，以及维护 run 与 JSONL 日志完成状态。
5. 精确筛选、全文搜索、Feed/Search/Detail 响应、联想计数和搜索 trigger。
6. 媒体物理删除后关系保留；Tweet 删除时关系随 FK cascade。
7. revision `022 -> 023 -> 022 -> 023` 的迁移边界。

WebUI 定向验收应覆盖：

1. Feed、Search、媒体预览和 Tweet Detail 都显示只读平台 Hashtag；自定义标签使用独立文字标签，不能只靠颜色区分。
2. 点击平台 Hashtag 后进入包含单个 `hashtag` 和显式 `tweet_status=all` 的搜索 URL；复制、刷新或直接打开 URL 后筛选保持。
3. 搜索筛选只在打开联想框后请求 `/api/v1/library/search/hashtags`，固定 `limit=20`，并覆盖加载、无结果、失败与显式重试。
4. 平台 Hashtag 在窄屏卡片和媒体预览中不溢出；调试模式遮罩平台内容且不生成包含真实 Hashtag 的搜索链接。

## 生产升级验收

先完成数据库备份并迁移到最新 revision。随后执行：

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml run --rm app backfill-hashtags
```

检查 dry-run 中的扫描总数、缺失/非法文件数、候选关系数、预计新增数和 gallery-dl 版本状态。只有统计合理时才执行：

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml run --rm app backfill-hashtags --apply --confirm
```

再次运行 dry-run，`would_insert_relationship_count` 应为 0。该维护动作不联网、不修改媒体文件，也不递归扫描未登记文件；运行摘要与错误分别保存在 Postgres 审计行和 `archive/logs/hashtag-backfill/`。

## 2026-08-14 M5.1 开发门禁记录

- Ruff 全仓检查通过。
- 后端完整测试 447 项通过；其中平台 Hashtag 真实 Postgres 集成测试覆盖增量写入、只增不减、dry-run/apply 幂等、中断审计与脱敏、搜索/API、未登记文件排除和媒体删除后保留。
- WebUI 生产构建通过；OpenAPI 与 `webui/src/api/generated.ts` 契约一致。
- 独立临时数据库成功执行 `base -> 023 -> 022 -> 023`；另在 023 写入一条维护 run 与日志索引后成功降级，确认旧 scope 约束不会被遗留数据阻断。最终三张新表、`trg_tweet_hashtags_refresh_search` 和 `hashtag_backfill` 日志作用域约束均存在。验证库完成后已删除。
- 2026-08-14 重建镜像实际安装 gallery-dl `1.32.7`；诊断服务按设计返回 `unverified` 和 `gallery_dl_unverified`，不阻断启动或下载。仓库契约 fixture 仍只声明已验证 `1.32.1`，未伪造对新版本的真实 X 验证结论。
- 全程未访问 X，未读取真实媒体内容或未登记目录。

## 2026-08-14 M5.2 开发门禁记录

- WebUI 使用独立的平台 Hashtag 展示组件；Feed、Search、媒体预览和 Tweet Detail 共享同一搜索 URL 语义。
- 搜索使用单值精确筛选和按需联想；联想请求固定 `limit=20`，不加载完整目录。
- Playwright 定向用例覆盖窄屏展示、预览、精确 URL 与刷新、加载/空/失败重试，以及调试模式下的遮罩和链接禁用。
- WebUI 生产构建通过；平台 Hashtag、整理工作流、搜索脱敏和洞察共 14 项 Playwright 定向回归通过。
