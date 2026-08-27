# 架构文档索引

本目录描述 `x-media-archiver` 当前已经落地的工程架构。文档中的“当前实现”必须能在代码、迁移或部署配置中找到对应事实；尚未实现的方向会明确标为“演进条件”或“候选方案”。

## 推荐阅读顺序

1. [系统架构总览](system-overview.md)：先理解系统边界、部署单元、模块分层和关键数据流。
2. [核心数据模型](data-model.md)：理解 Postgres 中四个业务域及数据库与文件系统的分工。
3. [可靠性与一致性设计](reliability-and-consistency.md)：理解队列租约、并发控制、幂等、故障恢复和审计策略。
4. [下载器契约](downloader-contract.md)：查看下载、回填、校验和文件路径的详细契约。
5. [来源扫描工作流](source-scanning-workflow.md)：查看来源发现、扫描会话、批量任务和调度状态机。
6. [WebUI 实时运行态](runtime-realtime-evolution.md)：查看持久事实、运行态投影、WebSocket 和降级轮询的一致性边界。
7. [媒体预览图任务](media-preview-jobs.md)：查看预览文件契约、持久任务、独立 worker 与调度语义。

## 文档地图

| 文档 | 主要读者 | 回答的问题 | 事实来源 |
| --- | --- | --- | --- |
| [系统架构总览](system-overview.md) | 新开发者、部署维护者 | 系统由什么组成，数据如何穿过系统，部署边界在哪里 | `api/app.py`、`workflow.py`、Docker/Compose、WebUI 与扩展入口 |
| [核心数据模型](data-model.md) | 后端开发者、数据维护者 | 哪张表拥有哪类事实，表之间如何关联，删除如何传播 | Alembic revisions、`tables.py` |
| [可靠性与一致性设计](reliability-and-consistency.md) | 后端开发者、故障排查人员 | 如何避免重复处理、并发冲突和重启后悬挂 | `services/queue.py`、`services/sources.py`、锁与恢复服务 |
| [下载器契约](downloader-contract.md) | 下载链路开发者 | gallery-dl / yt-dlp、媒体回填与校验如何协作 | `downloader.py`、`media.py`、`verifier.py` |
| [来源扫描工作流](source-scanning-workflow.md) | 来源功能开发者 | cursor、扫描会话、批量任务和下载提交如何协作 | `services/sources.py`、`source_bulk_tasks.py` |
| [WebUI 实时运行态](runtime-realtime-evolution.md) | 前后端开发者 | REST、WebSocket、Runtime Store 与数据库如何收敛 | runtime API、event broker、Runtime Provider |
| [媒体预览图任务](media-preview-jobs.md) | 前后端开发者、运维人员 | 图片/视频预览如何生成、调度、恢复与展示 | `services/media_previews.py`、migration 025、Operations Maintenance |

决策背景与取舍记录在 [ADR 索引](../adr/README.md)。测试边界与手工验收入口位于 [`docs/testing`](../testing/)。

## 图示约定

- 架构图优先展示部署单元和稳定依赖，不把每个 Python 文件画成独立服务。
- 时序图只展示关键成功路径；错误分类、重试和停止语义由对应专题文档补充。
- ER 图按业务域拆分，避免把全部表压进一张不可读的大图。
- 实线表示同步调用、持久关联或主要控制流；虚线表示外部调用、异步通知、逻辑引用或可选回退。
- Postgres 是业务状态的持久事实源；Runtime Store、WebSocket 消息和页面缓存都不是数据库替代品。

## 更新规则

出现以下变化时，应同步更新本目录：

- 新增独立部署单元、外部依赖或持久化介质。
- 改变队列领取、租约、写锁、重试或启动恢复语义。
- 新增核心表、跨域外键、搜索投影或审计表。
- 改变 `archive/` 目录布局、媒体删除边界或备份恢复要求。
- 把只读实时通道升级为写命令通道，或开始支持多应用实例。

文档只描述稳定边界。接口字段的精确契约以 `/openapi.json` 为准，数据库列和约束以最新 Alembic revision 为准。
