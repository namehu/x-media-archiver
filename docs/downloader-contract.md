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
