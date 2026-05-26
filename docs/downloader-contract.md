# Downloader Contract

> 本文档用于记录第 0 阶段对 `gallery-dl` / `yt-dlp` 的真实验证结果。  
> 只有验证通过的字段和命名模板才能进入 CLI 默认实现。

## 验证环境

```text
date:
docker image:
gallery-dl version:
yt-dlp version:
cookie mode: /app/secrets/cookies.txt
sample count:
```

## 样本覆盖

```text
1. 单图 tweet:
2. 多图 tweet:
3. 单视频 tweet:
4. GIF tweet:
5. 多媒体混合 tweet:
6. 不可访问 / 删除 tweet:
```

## gallery-dl 字段验证

```text
tweet id field:
author username field:
media index field:
extension field:
metadata file path:
download archive behavior:
```

建议输出模板：

```text
directory:
filename:
```

验证结果：

```text
pass/fail:
notes:
```

## yt-dlp 字段验证

```text
tweet id field:
uploader username field:
media index / playlist field:
extension field:
info json path:
download archive behavior:
```

建议输出模板：

```text
output:
```

验证结果：

```text
pass/fail:
notes:
```

## 统一输出契约

最终 CLI 实现必须能把下载结果归一到：

```text
archive/media/<author_username>/<tweet_id>/<tweet_id>--m<media_index>.<ext>
```

如果下载器无法直接生成该结构，CLI 负责下载后移动或重命名。

## 未匹配文件处理

无法确定 `tweet_id` 的文件必须移动到：

```text
archive/media/_unmatched/<job_id>/
```

并在 `download_attempts.error_message` 中记录：

```text
unmatched_download_output
```
