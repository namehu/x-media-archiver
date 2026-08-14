# Downloader Contract

> 本文档用于记录第 0 阶段对 `gallery-dl` / `yt-dlp` 的真实验证结果。  
> 只有验证通过的字段和命名模板才能进入 CLI 默认实现。

## 验证环境

```text
date: 2026-05-26 16:51:23 +08:00
docker image: x-media-archiver-xarchiver
gallery-dl version: 1.32.1
yt-dlp version: 2026.03.17
cookie mode: database cookie_config first, /app/secrets/cookies.txt fallback
sample count: 2
```

## 样本覆盖

```text
1. 单图 tweet: https://x.com/PhysInHistory/status/2058554692586885322
2. 多图 tweet:
3. 单视频 tweet: https://x.com/dpoddolphinpro/status/2059072547585433944
4. GIF tweet:
5. 多媒体混合 tweet:
6. 不可访问 / 删除 tweet:
```

## gallery-dl 字段验证

```text
tweet id field: tweet_id
author username field: author['name']
media index field: num
extension field: extension
metadata file path: <media-file>.json
download archive behavior: --download-archive writes a SQLite file at archive/state/gallery-dl-downloaded.txt
```

### 平台 Hashtag 元数据契约

已验证的 gallery-dl `1.32.1` Twitter extractor 会在普通 Tweet 与 Note Tweet 的媒体元数据顶层输出可选 `hashtags: list[str]`；值不带前导 `#`，无 Hashtag 时字段可以缺失。项目只在 gallery-dl 下载成功、scoped media backfill 已把元数据路径登记到 `media_assets.metadata_path` 后读取对应磁盘 JSON。

处理规则：

1. 只读取元数据顶层 `hashtags`，不从正文、X Article 正文、引用/转推嵌套对象或任意 `raw_import` 推断。
2. 只接受字符串数组，每条 Tweet 最多处理 100 项、每项最多 512 字符；移除一个可选前导 `#`，拒绝空白、控制字符和包含空格的值。
3. 使用 Unicode NFKC + casefold 生成唯一标识；关系保留该 Tweet 首次观察到的原始显示写法和位置。
4. 写入只增不减。字段缺失、空数组、文件缺失或解析失败都不清理已有关系；Hashtag 采集失败只写告警，不改变下载成功结果。
5. yt-dlp `.info.json`、来源扫描 `raw_import`、浏览器扩展与 CLI/API 输入不是本契约的数据源。

仓库保留 `1.32.1` 的代表性契约 fixture，但继续允许镜像安装更新版本。应用启动和诊断 API 会报告实际安装版本；不在已验证列表时只产生非阻断告警。版本升级影响字段契约时，应更新 fixture、解析测试与已验证版本列表，不应阻断原有下载。

建议输出模板：

```text
directory: configured through cli/gallery-dl.conf as ["{author[id]}", "{tweet_id}"]
destination: /app/archive/media
filename: {tweet_id}--p{num}.{extension}
```

验证结果：

```text
pass/fail: pass for photo tweet
notes:
  - Do not put absolute paths in gallery-dl directory config. Absolute paths are sanitized into literal path names.
  - Use --destination /app/archive/media plus relative directory template.
  - Cookies are injected at runtime with -o extractor.twitter.cookies=<archive/state/runtime-cookies.txt>.
  - Use -o extractor.twitter.cookies-update=false because the runtime copy is managed by the CLI.
  - For the tested video tweet, gallery-dl returned exit code 0 but emitted "No results" and did not download files.
  - CLI must not treat process exit code 0 as enough; it must verify that files or metadata map back to each tweet.
```

## yt-dlp 字段验证

```text
tweet id field: display_id or webpage_url_basename
media/video id field: id
uploader username field: uploader_id
media index / playlist field: not present for tested single video
extension field: ext
info json path: <output>.info.json
download archive behavior: --download-archive writes archive/state/yt-dlp-downloaded.txt
```

建议输出模板：

```text
output: /app/archive/media/%(uploader_id)s/%(id)s/%(id)s.%(ext)s
```

验证结果：

```text
pass/fail: pass for single video tweet
notes:
  - For tested video tweet, yt-dlp id was 2059071834138509312, while tweet/status id was 2059072547585433944.
  - The original tweet id is available in display_id, webpage_url_basename, webpage_url, and _old_archive_ids.
  - yt-dlp writes cookies back to the file passed with --cookies. The CLI writes the selected cookie source to archive/state/runtime-cookies.txt and passes that runtime copy to yt-dlp.
  - yt-dlp downloaded .mp4, .jpg thumbnail, and .info.json.
  - 媒体回填会优先基于下载器缩略图生成同目录 `<media-stem>.preview.jpg`；缩略图不存在时使用 ffmpeg 从视频截帧。该文件是可重建的 WebUI 派生预览，不写入 `media_assets`，也不影响媒体校验状态。
```

## Cookies 来源契约

下载与来源扫描共用同一 cookies 解析规则：

```text
1. 如果 Postgres cookie_config.content 有非空内容，优先使用数据库内容。
2. 否则，如果 COOKIE_FILE 指向的文件存在且非空，读取该文件。
3. 否则按 cookies 缺失处理。
```

实际下载前，CLI/API worker 会把选中的 cookies 内容写入：

```text
archive/state/runtime-cookies.txt
```

`gallery-dl` 与 `yt-dlp` 都只接收这个运行时文件路径。API 和 WebUI 只返回 cookies 配置状态、来源、备注、更新时间、声明过期时间和最近检测结果，不返回 cookies 正文、内容哈希或临时文件路径。

WebUI 保存数据库 cookies 前会校验 Netscape 七列格式、X/Twitter 域、`auth_token`、`ct0` 与非零 expiration。保存后可调用 `POST /api/v1/settings/cookies/check`，使用独立的 `0600` 临时文件对 `https://x.com/i/bookmarks` 执行 limit=1 的 gallery-dl 认证探测。stdout 会被丢弃，检测完成后删除临时文件。检测不启用 `cookies-update`，不承担 token 刷新职责。

## 统一输出契约

最终 CLI 实现必须能把下载结果归一到：

```text
archive/media/<author_id>/<tweet_id>/<tweet_id>--p<media_index>.<ext>
```

`author_username` remains metadata in Postgres for display/search. Filesystem paths should use stable
ID-like segments, not usernames, because usernames can change and path-unsafe characters should not
control archive layout.

## 下载进度契约

下载进度按以下优先级采集：

```text
yt-dlp / gallery-dl 原生进度
  -> 当前明确文件或 .part 文件的定向 stat
  -> 当前批次 Tweet ID 的低频全目录兜底扫描
```

yt-dlp 使用 `--progress-template` 输出 Tweet `display_id`、已下载字节、总字节
或估算总字节以及速度。gallery-dl 使用自定义 `output.mode` 输出带稳定前缀的
`start`、`progress`、`success` 和 `skip` 事件。
gallery-dl 的字节与速度占位符是带十进制或二进制单位的格式化值，CLI 负责还原为
整数；该值用于实时展示，不替代下载完成后的真实文件大小回填。

gallery-dl 的原生进度是单文件粒度。CLI 必须累计同一 Tweet 已完成文件的大小，
但不能把当前单文件总大小当作整个 Tweet 的总大小。总大小未知时 WebUI 显示
“估算中”。

全目录递归扫描仅作为最后兜底，由以下配置控制：

```text
DOWNLOADER_PROGRESS_FALLBACK_INTERVAL_SECONDS=10
```

默认每 10 秒最多执行一次，设置为 `0` 时完全禁用。进度解析或采样失败只能降低
可观测性，不得中断下载或改变错误分类。

如果下载器无法直接生成该结构，CLI 负责下载后移动或重命名。

当前验证结论：

```text
gallery-dl:
  可以直接满足统一输出契约。

yt-dlp:
  不能直接满足 tweet_id 目录契约，因为 %(id)s 是视频内部 id。
  CLI 后续需要根据 .info.json 中的 display_id / webpage_url_basename 将文件归一化到 tweet_id 目录。
```

## 未匹配文件处理

无法确定 `tweet_id` 的文件必须移动到：

```text
archive/media/_unmatched/<job_id>/
```

并在 `download_attempts.error_message` 中记录：

```text
unmatched_download_output
```

## queue-v1 真实验收记录

验证时间：

```text
date: 2026-05-27
runner: local API worker
pipeline_version: queue-v1
run range: archive_runs 51-55
```

批次结果：

```text
run 51:
  input: 1 tweet
  tweet_id: 2058990987272458377
  result: completed
  item_status: verified
  media: 1 photo
  source_engine: gallery-dl
  media_status: verified

run 52:
  input: 1 tweet
  tweet_id: 2059323339655782695
  result: completed
  item_status: verified
  media: 1 video
  source_engine: gallery-dl
  media_status: verified

run 53:
  input: repeat of tweet_id 2059323339655782695
  result: completed
  item_status: skipped_verified
  media_backfill_count: 0
  verified_media_count: 0

run 54:
  input: repeat of tweet_id 2058990987272458377
  result: completed
  item_status: skipped_verified
  media_backfill_count: 0
  verified_media_count: 0

run 55:
  input: 1 invalid / no downloadable media sample
  tweet_id: 2058990187272458377
  result: completed_with_failures
  item_status: failed_permanent
  attempts:
    - gallery-dl: failed_retryable, error_category=download_no_output
    - yt-dlp: failed_permanent, error_category=unsupported_media
  final_item_error_category: unsupported_media
```

验收结论：

```text
1. 新图片 tweet 可完成 download -> scoped backfill -> scoped verify -> verified。
2. 新视频 tweet 可完成 download -> scoped backfill -> scoped verify -> verified。
3. 已 verified tweet 再次提交会生成 skipped_verified item，不重新下载、不重新 backfill、不重新 hash verify。
4. queue item 能关联 download_attempts，WebUI 可展示每次下载尝试的 engine/status/error_category。
5. fallback 后的最终 item 错误取最后一次下载 attempt；run 55 最终为 unsupported_media。
```

## queue-v1 错误分类契约

下载器和队列层对用户暴露以下稳定错误类别：

```text
invalid_url:
  URL 无效、tweet 不存在或下载器明确返回 404 / not found。
  默认处理：failed_permanent。

download_no_output:
  下载器进程没有报错或只返回 No results，但 scoped backfill 无法找到本次 tweet 的 metadata/media。
  默认处理：failed_retryable，并允许 fallback engine 继续尝试。

auth_required:
  cookies 缺失、cookies 无效、未登录、403/unauthorized/forbidden。
  默认处理：failed_retryable；用户应检查 cookies。

rate_limited:
  429 或 rate limit。
  默认处理：failed_retryable，等待 backoff 后重试。

network_error:
  timeout、connection、temporary failure 等网络问题。
  默认处理：failed_retryable，等待 backoff 后重试。

unsupported_media:
  下载器明确表示目标 tweet 没有可下载视频/媒体，或媒体类型不受当前下载器支持。
  默认处理：failed_permanent。

unknown:
  其他无法稳定归类的 stderr / exit code。
  默认处理：failed_retryable，达到 retry limit 后转 failed_permanent。
```

分类边界：

```text
gallery-dl "No results" 更接近 download_no_output。
yt-dlp "No video could be found in this tweet" 更接近 unsupported_media。
如果同一 queue item 经 fallback 后有多个 attempt，最终 item error 使用最后一个 attempt 的分类，但历史 attempts 必须完整保留。
```

## source discovery 真实验收补充

验证时间：

```text
date: 2026-05-27
source: https://x.com/earthcurated/media
gallery-dl version: 1.32.1
```

已确认：

```text
1. media 页使用 --range 时，范围单位是媒体项，而不是 Tweet。
   range 1-20 与 201-220 均返回 20 个媒体项，但分别仅对应 13 条去重 Tweet。
2. --dump-json 会同时给出页面 metadata 与当前选中媒体事件。
   对 media 来源，只能将带当前批媒体事件的 Tweet 作为本批发现结果。
3. 数字 --range 仅限制输出范围，不能作为万条级可恢复分页的性能 checkpoint。
   range 201-220 的受控扫描耗时约 4 分 25 秒。
4. 当前版本的 Twitter extractor 源码支持 cursor 配置及 continuation cursor 推进；
   来源历史扫描现已接入该原生 cursor。
5. 原生 cursor 真实验证：native baseline 批次 `1-20` 返回 20 Tweet / 32 媒体，
   continuation 批次 `21-40` 返回 20 Tweet / 36 媒体；第二批使用并更新了首批保存的 cursor。
```

详细验收记录见 [`source-scanning-acceptance.md`](../testing/source-scanning-acceptance.md)。

## M0 隔离闭环验收补充

验证时间：2026-08-12。

在用户明确授权的 `user_media` 来源上限制发现和提交 5 条，并使用独立数据库与隔离归档目录执行完整链路。已确认：

1. latest refresh 只写 5 条 discovery，不隐式创建归档 run，也不推进 history checkpoint。
2. history 批次返回 continuation cursor 时保持未完成，并持久化下一批位置；暂停和 API 重启不会丢失 checkpoint。
3. 人工提交后仅创建 1 个 run 和 5 个唯一 item；下载 worker 只领取这 5 项。
4. 5 个下载 attempt 均为 `downloaded`，scoped backfill 与 verify 后 5 个 item、Tweet 和媒体资产均为 `verified`。
5. 物理路径均符合 `archive/media/<author_id>/<tweet_id>/`；隔离目录全量复核结果为 verified 5、missing 0、corrupt 0。

本次真实验收未主动制造 `rate_limited`、`auth_required` 或 `network_error`，避免无必要地扩大外部请求；定向测试覆盖限流/认证暂停及网络错误不推进 cursor，其余页面展示和人工恢复仍按手工清单验收。详细记录见 [`../testing/source-scanning-acceptance.md`](../testing/source-scanning-acceptance.md)。
