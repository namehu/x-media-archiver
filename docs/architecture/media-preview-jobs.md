# 媒体预览图任务

媒体预览图是可重建的文件系统派生物，不写入 `media_assets`，也不参与下载或校验状态。生成链路与下载完全解耦：下载、scoped backfill 和 full backfill 都不会创建任务或生成预览；只有 Operations 中的手动操作和内部定时器可以创建持久任务。

## 文件契约

| 媒体 | 派生文件 | 生成规则 |
| --- | --- | --- |
| 图片 | `<stem>.preview.webp` | Pillow 12.3.0；首帧、EXIF 转正、sRGB、保留 alpha、最长边 640、不放大、WebP quality 82 |
| 视频 | `<stem>.preview.jpg` | 优先读取 `<stem>.thumb.jpg`，否则 ffmpeg 截帧；最大宽度 640 |

API 中 `media_url` 始终指向原媒体，`preview_url` 只在派生文件真实存在时返回，并按文件 mtime 与大小附加版本参数。列表和卡片先请求 `preview_url`，失败一次后回退 `media_url`；全屏图片和视频播放仍使用原媒体。隐私遮罩开启时不挂载媒体元素，因此不会请求预览或原文件。

媒体物理删除会按 `media_assets.id` 精确删除主文件、元数据、下载器缩略图、`.preview.jpg` 和 `.preview.webp`。预览响应使用 `private, max-age=31536000, immutable`，版本变化由 URL 参数完成缓存击穿。

## 持久任务

`media_preview_jobs` 保存任务状态、冻结的最大媒体 ID、ID 游标、计数、租约、重试和至多 100 条脱敏失败样本。候选只来自数据库：

```text
media_assets.local_path is not null
download_status in (downloaded, verified)
media_type in (photo, video)
id <= snapshot_max_media_id
```

任务每批读取 100 行并串行生成。`reconcile` 只处理缺失、过期或无法解码的预览；`force` 重建所有候选。任务状态为 `queued -> running -> completed | completed_with_failures | failed | cancelled`。单个媒体失败会累计并继续，任务级异常按约 1、5、15 分钟最多重试三次。

预览 worker 是 FastAPI lifespan 启动的独立 CPU/IO 线程，不占用扫描与下载共享的网络 worker。运行任务使用 60 秒租约并持续续租；进程重启时会恢复过期任务。取消是协作式的，当前文件结束后停止，已经生成的预览保留。

生成先写入源文件同目录的唯一临时文件。发布前在短事务中锁定对应 `media_assets` 行，复核行状态、路径和源文件 `(size, mtime_ns)`，随后用 `os.replace` 原子替换；若媒体在生成期间被删除或改变，只清理临时文件并记录失败，不留下游离预览。

## 调度与实时状态

`media_preview_scheduler_settings` 是 `id = 1` 的单例配置，默认关闭，默认计划为 `Asia/Shanghai` 每日 03:30。支持固定间隔、每日和每周。计划到期但已有活动任务时不推进锚点；活动任务结束后创建一个合并的 `reconcile` 任务，再推进下一次运行时间。

数据库通过部分唯一索引保证全局最多一个 `queued/running` 任务。终态历史保留 90 天，但至少保留最近 100 条，清理只删除任务记录。

运行进度通过现有 `/api/v1/runtime/ws` WebSocket 的 `runtime.snapshot` 和 `runtime.patch` 推送；断线时沿用 runtime REST 快照轮询。任务历史与计划仍由 REST/React Query 持有，创建、结束和计划变更事件只负责使对应查询失效。

## API

```text
POST  /api/v1/maintenance/preview-jobs
GET   /api/v1/maintenance/preview-jobs
GET   /api/v1/maintenance/preview-jobs/{id}
POST  /api/v1/maintenance/preview-jobs/{id}/cancel
GET   /api/v1/maintenance/preview-schedule
PATCH /api/v1/maintenance/preview-schedule
```

手动创建始终要求 `confirm_full_scan=true`；`force` 还要求 `confirm_force=true`。这里的“全量”只表示遍历数据库冻结的候选集合，不会递归扫描 `archive/media`。
