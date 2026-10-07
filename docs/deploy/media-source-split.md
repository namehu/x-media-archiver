# 图片与视频来源升级、拆分

本次发布新增 `user_photos`（博主图片）和 `user_videos`（博主视频）。旧 `user_media` 自动按“旧媒体来源”展示，仅可查看历史和停止/隐藏旧来源；不会再派发新的扫描或下载。现有归档媒体、Tweet、下载任务和扫描历史均保留。

## 升级前

1. 明确本次操作的部署目录、Compose 配置、数据库与归档挂载，备份数据库。媒体文件不受本次拆分修改，仍按常规策略单独备份。
2. 关闭旧来源关联的定时策略，停止扫描会话，等待或停止已有下载、批量任务。暂停的下载或批量任务仍属于未完成工作，也会阻止拆分。
3. 停止旧版本 API/worker 和其他 CLI 写入进程。以下结构升级和拆分应在维护窗口执行，避免旧进程重新创建混合来源或同时派发任务。

## 升级结构

以下示例使用仓库默认开发 Compose 服务 `xarchiver`。生产请在已经确认的部署目录中使用对应 `--env-file`、`-f` 和服务名（例如 `app`），不要直接套用到未知实例。

```bash
docker-compose build xarchiver
docker-compose run --rm xarchiver db migrate
```

迁移 `027_split_media_sources` 仅调整 URL 唯一索引并新增 `source_media_splits` 审计映射表，不自动拆分任何来源。旧媒体与当前来源分属两个 URL 唯一分区，因此旧媒体和新视频可拥有相同 `/media` URL；相同当前 URL 仍不能重复创建。

## 预览和执行

```bash
# 默认只读，可重复指定 --source-id；与 --all 二选一
docker-compose run --rm xarchiver sources split-media --source-id 123
docker-compose run --rm xarchiver sources split-media --all

# 核对 ready、blockers、conflicts、batch_conflicts、history 后显式执行
docker-compose run --rm xarchiver sources split-media --source-id 123 --apply
```

- `ready`：可拆分。`blocked`：需处理活跃扫描、下载、批量任务、已启用策略或目标 URL 冲突；不覆盖已有目标来源，包括软删除的来源。存在阻塞时命令退出码为 1。
- `conflicts` 列出数据库中已有的目标来源；`batch_conflicts` 列出本批待拆分来源之间重复的目标 URL，以及争用该 URL 的全部 `old_source_ids`。例如同一账号的主页和 `/media` 两条旧来源会生成相同目标，两条均标记 `blocked`。预览和 `--apply` 都先检查整批，冲突来源均不写入；请人工选定其中一条，单独用 `--source-id` 执行，不自动合并旧历史。批次内其他无冲突来源仍可正常拆分。
- `split`：已创建图片和视频两条来源，默认 `paused`、`cursor_state={}`、无定时策略和下次扫描时间。旧来源软删除并停止自动化，旧发现关系、扫描/下载历史与游标保留。
- `already_split`：返回既有映射，不重复创建、不重置新来源进度。
- 每个旧来源单独事务处理。中途失败会回滚该来源的拆分；批量中的其他成功项保持成功，重新执行可继续。`--all` 包含未删除旧来源及已经有拆分映射的旧来源；单独指定 ID 可处理此前已软删除的旧来源。

也可保留旧来源，只通过 WebUI 手动新增图片、视频两条来源。这样不会建立拆分映射；以后执行拆分命令会报告目标 URL 冲突，不自动收编手动来源。

## 重新扫描

重新启动新版本服务，分别打开图片、视频来源点击“开始扫描”。两条来源独立从头建立发现池和游标，沿用历史扫描、补充最新、从头补断层的模式。

扫描只发现 Tweet，不会下载。提交下载后，已 `verified` 的 Tweet 自动跳过，进行中的 Tweet 关联已有任务；失败、缺失和主动强制重下仍沿用原有规则。混合 Tweet 共享一次完整归档。旧发现记录不会自动显示到新来源，需等待重新扫描建立关系。

当前 gallery-dl 的媒体枚举仍可能受到 X 上游接口变化影响；应用层按媒体类型过滤不会补出上游未返回的数据。不要将空匹配批次直接等同于“该用户没有图片/视频”，应结合原始条数、cursor 和错误日志判断。

## 回滚

应用了拆分映射后，迁移会拒绝 downgrade，防止丢失审计或恢复成不成立的 URL 唯一约束。需要回到旧版本时，在停止写入后恢复升级前数据库备份；不要删除映射强行降级。即使尚未执行拆分，只要手工建立的新旧来源 URL 已重叠，旧唯一索引也无法恢复。
