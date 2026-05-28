# x-media-archiver Todo Roadmap

> 状态：活跃待办入口  
> 整理日期：2026-05-28  
> 原则：已完成阶段规划移入 `docs/design/archive/`；本文只保留仍需要评估、验证或实现的事项。

## 已归档的历史规划

以下文档已完成主要使命，保留为历史上下文：

| 文档 | 归档原因 |
| --- | --- |
| `archive/roadmap-todo.md` | 第一阶段能力与验收清单已完成。 |
| `archive/x-media-archiver-final-design.md` | V0/V1 基础架构设计已完成。 |
| `archive/x-media-archiver-v2-design.md` | V2 启动规划已被 P2/P3 实现超越。 |
| `archive/phase-2-roadmap.md` | P2 主体已完成，剩余项抽到本文。 |
| `archive/phase-3-roadmap.md` | P3 主体已完成，剩余硬化项抽到本文。 |
| `archive/phase-3.4-plan.md` | 历史阶段计划，已被实际 P3 推进顺序覆盖。 |

当前仍保留在 `docs/design/` 根目录的配套文档：

| 文档 | 用途 |
| --- | --- |
| `p3-manual-acceptance.md` | API + WebUI 手工验收清单，仍作为人工验证入口。 |

## 当前事实基线

已完成：

1. CLI / API / WebUI 共享数据库队列模型。
2. `/api/v1/*` 成为唯一业务 API 路径，旧 `/api/*` 业务兼容层已移除。
3. WebUI 已接入分页、筛选、SSE 刷新、健康状态、Toast、交互系统和 OpenAPI generated types。
4. API 层已有统一错误响应、主要 response model、JSON 结构化日志和 `X-Request-ID`。
5. Archive Queue、Sources、Library、Failures、Duplicates 等主页面已完成规模化基础。
6. E2E 当前明确不作为近期任务；主链路继续使用手工验收。

保持不做：

1. 不默认执行真实 X 大批量扫描或下载。
2. 不自动提交来源扫描结果到下载队列。
3. 不做媒体文件物理删除。
4. 不做公网服务、代理池、账号轮换、cookies 自动读取或上传。
5. 不把 Playwright 无人值守扫描作为近期方向。

## 待评估事项

### A. 来源扫描可信运行验收

性质：真实运行验收为主，必要时补小代码修正。  
优先级：高。  
理由：这是大规模来源归档前最需要确认的风险面。

- [ ] 用空库或干净测试库复验 native cursor 的终止条件：不足一批不能误判完成，只有 extractor 明确结束或可证明空批次才完成。
- [ ] 复验暂停、恢复、API 重启后的 checkpoint 延续行为。
- [ ] 验证下载队列运行期间来源扫描会等待，不造成扫描与下载请求叠加。
- [ ] 用真实或可控模拟的 `rate_limited`、`auth_required`、`network_error` 验收自动暂停、错误展示和恢复操作。
- [ ] 将验收结论同步到 `docs/source-scanning-acceptance.md` 与 `docs/downloader-contract.md`。

### B. 受控下载联调验收

性质：小批量真实链路验收。  
优先级：高，但必须受控执行。  
理由：扫描发现和下载队列已经分离，需要证明发现结果进入下载后的状态关联是可解释的。

- [ ] 从真实来源选择少量未入队发现项，按 5 - 20 条分批提交下载。
- [ ] 验证扫描不会自动提交下载，只有人工确认后才创建 Archive Queue run。
- [ ] 验证 `QUEUE_BATCH_SIZE` 与下载随机延迟在实际执行中生效。
- [ ] 验证媒体文件路径仍符合 `archive/media/<author_id>/<tweet_id>/` 稳定目录原则。
- [ ] 验证扫描预估媒体数与下载完成后的 `media_assets` 数量差异可解释。
- [ ] 验证下载失败能从来源发现项关联到 Archive Queue run/item/attempt。

### C. 来源生命周期与调度策略

性质：产品/实现设计。  
优先级：中。  
理由：来源数量变多后，需要明确如何停止关注、隐藏、归档和周期性补扫。

- [ ] 设计来源归档/隐藏能力，不触碰媒体文件删除。
- [ ] 评估是否允许安全删除纯 metadata 来源记录；若允许，需单独设计审计与确认机制。
- [ ] 设计历史扫描完成后的“定期最新补扫”调度策略。
- [ ] 明确补扫频率、限流策略、暂停入口和失败恢复语义。

### D. 插件直接投递预研

性质：安全模型设计，暂不实现。  
优先级：中低。  
理由：文件导出仍可作为 fallback；直接投递只有在日常采集频繁时才明显增益。

- [ ] 设计本地服务配对机制。
- [ ] 设计一次性 token 或本地授权确认。
- [ ] 明确 CORS、来源限制和过期策略。
- [ ] 保证插件不发送 cookies。
- [ ] 保留 TXT/JSONL 文件导出作为 fallback。

### E. 可观测性体验增强

性质：体验增强。  
优先级：中低。  
理由：后端已经输出结构化日志，是否继续做前端日志消费取决于实际排障频率。

- [ ] 评估是否在 Operations 增加最近业务事件或实时日志尾巴。
- [ ] 评估是否需要错误分类视图，按 `archive_item`、`source_scan`、`download_attempt` 聚合。
- [ ] 评估 worker 写锁状态是否需要 SSE 事件，而不是只依赖 health detail。

### F. 工程约束

性质：开发流程硬化。  
优先级：中低。  
理由：CI 已有基础门禁；lint/pre-commit 会改善一致性，但也会增加维护成本。

- [ ] 决定是否引入 Python `ruff check` 到 CI 或 pre-commit。
- [ ] 决定是否引入 WebUI ESLint/Prettier，避免一次性格式化历史文件。
- [ ] 若引入 pre-commit，只对改动文件执行轻量检查。
- [ ] 后续按风险补服务层测试，不追求无目标覆盖率扩张。

### G. 生产与备份演练

性质：部署验证。  
优先级：按实际部署时间决定。  
理由：本地开发链路已稳定，但生产 metadata 库恢复需要单独验证。

- [ ] 在自有 Supabase 项目执行 migration validation。
- [ ] 记录 metadata 数据库备份与恢复演练结果。
- [ ] 复核生产环境不得暴露 `DATABASE_URL`、cookies 或用户导出数据。

## 建议下一步评估顺序

当前不急于继续开发新功能。下一轮应先做一次取舍评估：

1. 如果目标是“大型来源长期跑得住”，优先做 **A 来源扫描可信运行验收**。
2. 如果目标是“确认发现到下载闭环可靠”，优先做 **B 受控下载联调验收**。
3. 如果目标是“日常使用更省操作”，再评估 **C 来源生命周期与调度策略** 或 **D 插件直接投递预研**。
4. 如果近期主要是代码维护，再评估 **F 工程约束**。
