# 来源扫描真实验收记录

## 2026-05-27: `earthcurated/media` 受控验证

验证对象：

```text
source_id: 1
source_url: https://x.com/earthcurated/media
source_type: user_media
downloading: 未提交下载队列，仅执行来源发现
gallery-dl version: 1.32.1
```

本次验收开始时，来源已经由早期实现扫描过部分范围。那些记录只用于定位问题，不作为
修正后枚举准确性的通过证据。项目当前按新项目处理，真实复验可以直接重置数据库后
从空库开始，不再为早期数字 checkpoint 设计兼容路径。

## 已确认结论

### 1. 媒体页的 `--range` 以媒体项计数，不以 Tweet 计数

修正解析器后的真实批次：

| scan run | 触发方式 | 范围 | 去重 Tweet | 媒体预估 | 新增 Tweet | 结论 |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| `#3` | 从最新补扫 | `1-20` | 13 | 20 | 0 | 一条 Tweet 可包含多张媒体 |
| `#5` | 手工历史续扫 | `201-220` | 13 | 20 | 11 | 范围应按媒体项理解 |

因此媒体页一批 `20` 个媒体项发现少于 `20` 条 Tweet 属于正常结果。

### 2. 修正前解析器会把范围外页面元数据错误落库

旧 API worker 在修正前完成的批次：

| scan run | 范围 | 记录 Tweet | 媒体预估 | 判定 |
| --- | ---: | ---: | ---: | --- |
| `#1` | `161-180` | 111 | 20 | 失败证据：记录了范围外 metadata |
| `#2` | `181-200` | 123 | 20 | 失败证据：记录了范围外 metadata |

原因：`gallery-dl --dump-json` 会输出页面级 Tweet metadata 事件和被选中的媒体事件；
媒体页使用 `--range` 时，只有带当前批媒体事件的 Tweet 才应视为发现结果。

修正：媒体页解析现在仅落库至少含一个当前批媒体事件的 Tweet，同时保留该 Tweet
对应的正文和作者信息。

### 3. 从最新补扫不得改变历史 checkpoint

`scan run #3` 的审计记录：

```text
trigger: latest_refresh
cursor_before.next_start_index: 181
cursor_after.next_start_index: 181
completed: false
```

实现已修正为：从最新补扫只更新发现结果和扫描审计，不推进历史 cursor，也不因空批
而将历史扫描标记完成。

### 4. 停止与在途批次存在竞态，已修正

验收中观察到：停止自动扫描后，旧 worker 的在途批次完成时曾以旧
`cursor_state` 覆盖 `automation_enabled=false`，导致后台继续发起下一批。

修正：

- 批次完成只将扫描进度字段合并进数据库中的最新 `cursor_state`，不覆盖新的停止状态。
- worker 调度下一批前重新读取来源，只有仍启用自动扫描时才安排下一轮。
- 旧 API 容器已经停止；中断批次通过扫描审计记录标记。

## 阻断结论：数字 offset 不能支撑大账号后台历史扫描

修正后的 `scan run #5` 从 `201-220` 扫描耗时：

```text
started_at:  2026-05-27 20:27:17 +08:00
finished_at: 2026-05-27 20:31:42 +08:00
elapsed:     4 分 25 秒
```

即使最终仅落库 `20` 个媒体项对应的 `13` 条 Tweet，深层数字范围仍需要明显更长的
枚举时间。继续用 `--range 201-220`、`221-240` 的方式推进，无法证明访问成本随批次
稳定，也不适合几千至上万条媒体的长期后台运行。

已检查当前容器中的 `gallery-dl` Twitter extractor：其内部支持 `cursor` 配置，并由
分页 API 在每页推进 continuation cursor。仅保存数字范围未满足原始的大规模可恢复
扫描目标，因此后续实现不再把数字 offset 当作真实分页 checkpoint。

## 原生 cursor 接入验证

数字 offset 问题确认后，来源扫描实现切换为：

```text
gallery-dl --post-range 1-<batch> -o limit=<batch> [-o cursor=<saved-cursor>]
```

其中 `cursor` 为 Twitter extractor 返回的 opaque continuation cursor，持久化在
`archive_sources.cursor_state.extractor_cursor` 中。真实批次结果：

| scan run | 模式 | 逻辑范围 | Tweet | 媒体预估 | cursor 行为 |
| --- | --- | ---: | ---: | ---: | --- |
| `#6` | native baseline | `1-20` | 20 | 32 | 从最新页建立原生 cursor |
| `#7` | native continuation | `21-40` | 20 | 36 | 使用 `#6` cursor 并保存新 cursor |

审计核对结果：

```text
run #6: cursor_before 无 extractor_cursor，cursor_after 有 extractor_cursor
run #7: cursor_before 有 extractor_cursor，cursor_after 有不同的新 extractor_cursor
source cursor after run #7: next_start_index=41, automation_enabled=false
```

这证明媒体来源已能以下载器原生 continuation cursor 继续，而不再依赖不断增大的
数字 `--range` 重放历史页面。`#6` 和 `#7` 仍为手工受控批次，未启用后台自动任务。

## 当前处置

```text
1. 扫描不会自动提交下载，保持不变。
2. user_media 来源历史扫描已接入原生 cursor；当前来源仍保持停止，未自动继续请求。
3. 后续验收按空库或清理后的新项目状态执行，不保留旧 checkpoint 兼容分支。
4. profile /timeline、到达结尾、API 重启恢复及错误暂停仍需继续验收。
```

## 后续必须完成

```text
P2.8.2b  剩余验收
  - 用 profile /timeline 验证 native cursor 语义。
  - 验证到达结尾、停止/恢复和 API 重启后的 cursor 延续。
  - 如需真实复验，可重置数据库后重新登记来源并从空库开始。
  - 完成复验前，不批量提交来源全部未入队项到下载队列。
```
