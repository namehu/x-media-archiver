# Downloader Contract

> 本文档用于记录第 0 阶段对 `gallery-dl` / `yt-dlp` 的真实验证结果。  
> 只有验证通过的字段和命名模板才能进入 CLI 默认实现。

## 验证环境

```text
date: 2026-05-26 16:51:23 +08:00
docker image: x-media-archiver-xarchiver
gallery-dl version: 1.32.1
yt-dlp version: 2026.03.17
cookie mode: /app/secrets/cookies.txt
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

建议输出模板：

```text
directory: configured through cli/gallery-dl.conf as ["{author[name]}", "{tweet_id}"]
destination: /app/archive/media
filename: {tweet_id}--m{num}.{extension}
```

验证结果：

```text
pass/fail: pass for photo tweet
notes:
  - Do not put absolute paths in gallery-dl directory config. Absolute paths are sanitized into literal path names.
  - Use --destination /app/archive/media plus relative directory template.
  - Use -o cookies-update=false because secrets/cookies.txt is mounted read-only.
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
  - yt-dlp writes cookies back to the file passed with --cookies. Since secrets/cookies.txt is read-only, CLI copies it to archive/state/yt-dlp-cookies.txt and passes that runtime copy to yt-dlp.
  - yt-dlp downloaded .mp4, .jpg thumbnail, and .info.json.
```

## 统一输出契约

最终 CLI 实现必须能把下载结果归一到：

```text
archive/media/<author_username>/<tweet_id>/<tweet_id>--m<media_index>.<ext>
```

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
