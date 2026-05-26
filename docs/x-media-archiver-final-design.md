# x-media-archiver 最终设计文档

> 版本：V0.2 设计定稿  
> 日期：2026-05-26  
> 设计原则：下载与媒体解析统一交给 `gallery-dl` / `yt-dlp`，本项目聚焦扫描、导入、调度、归档与元数据管理。

---

## 1. 项目目标

开发一个本地化 X/Twitter 媒体归档工具，用于备份用户可访问范围内的媒体资源，包括：

```text
1. 个人 Bookmarks / 收藏夹中的图片、视频、GIF、多图、多视频
2. 某个账号 media 页面下的媒体内容
3. 单条或批量 tweet URL 中的媒体内容
4. 对应推文文本、作者、发布时间、链接、媒体数量等元数据
5. 支持失败重试、断点续跑、去重、统一命名
```

项目定位是**个人归档工具**，不是爬虫框架，也不是绕过 X/Twitter 限制的工具。

本项目明确不做：

```text
1. 不破解 X 内部接口
2. 不直接解析 video_info.variants
3. 不自己实现 X 视频真实地址解析
4. 不提供代理池、账号轮换、风控规避能力
5. 不共享 cookies / tokens
```

---

## 2. 核心设计结论

本项目采用更简单、更稳定的职责划分：

```text
Chrome Extension：
  只负责“看见”和“导出”
  不负责下载
  不负责视频解析

Local CLI：
  负责“导入、调度、归档、入库、重试”
  不自己解析 X 媒体真实直链
  通过 gallery-dl / yt-dlp 完成媒体解析和下载

gallery-dl / yt-dlp：
  负责“解析 tweet URL 并下载媒体”
  是本项目的核心下载引擎

Postgres：
  负责保存 tweet、media、job、attempt 等元数据
  开发阶段使用 Docker Postgres
  生产/个人长期归档使用 Supabase Postgres
  不保存大体积媒体文件

Local Archive Storage：
  负责保存真实图片、视频、GIF、metadata 文件
```

---

## 3. 下载链路设计

本项目统一采用成熟下载引擎处理 tweet URL 到媒体文件的解析与下载，链路如下：

```text
tweet URL
  ↓
gallery-dl / yt-dlp
  ↓
解析媒体地址
  ↓
下载媒体
  ↓
写入本地 archive
  ↓
CLI 读取下载结果并写入 Postgres
```

这样可以把插件与 CLI 的职责聚焦在采集、导入、调度、归档与元数据管理上。

---

## 4. 用户场景

### 4.1 场景 A：归档自己的 Bookmarks / 收藏夹

用户打开：

```text
https://x.com/i/bookmarks
```

Chrome 插件扫描当前页面和自动滚动过程中出现的 tweet，导出：

```text
tweet_urls.txt
tweets.jsonl
```

然后本地 CLI 导入并下载：

```bash
xarchiver import ./archive/raw/imports/bookmarks_2026-05-26.jsonl
xarchiver download --engine gallery-dl
xarchiver download --engine yt-dlp --only-failed-or-video
```

---

### 4.2 场景 B：归档某个账号 media 页面

用户打开：

```text
https://x.com/<username>/media
```

插件扫描该页面可见的 tweet，导出 tweet URL 和基础元数据。

后续由本地 CLI 调用 `gallery-dl` / `yt-dlp` 下载。

---

### 4.3 场景 C：批量下载已有 tweet URL

用户已经有一批 tweet 链接：

```text
https://x.com/user/status/123456789
https://x.com/user/status/234567890
```

直接运行：

```bash
xarchiver import-urls ./tweet_urls.txt
xarchiver download
```

---

## 5. 总体架构

```text
┌────────────────────────────┐
│ Chrome Extension            │
│ - 扫描当前 X 页面            │
│ - 提取 tweet_id / url / 文本 │
│ - 导出 JSONL / TXT           │
│ - 不解析媒体直链             │
└──────────────┬─────────────┘
               │
               ▼
┌────────────────────────────┐
│ Dockerized Local CLI        │
│ xarchiver                   │
│ - import                    │
│ - download                  │
│ - retry                     │
│ - verify                    │
│ - export                    │
│ - sync metadata to PG       │
└──────────────┬─────────────┘
               │
      ┌────────┴────────┐
      ▼                 ▼
┌──────────────┐  ┌──────────────┐
│ gallery-dl   │  │ yt-dlp        │
│ 图片/多图     │  │ 视频/GIF      │
│ metadata     │  │ info.json     │
└──────┬───────┘  └──────┬───────┘
       ▼                 ▼
┌────────────────────────────┐
│ Local Archive Storage       │
│ archive/media/raw/logs      │
└──────────────┬─────────────┘
               │
               ▼
┌────────────────────────────┐
│ Postgres                    │
│ tweets/media/jobs/attempts  │
│ dev: Docker PG              │
│ prod: Supabase PG           │
└────────────────────────────┘
```

---

## 6. 技术选型

### 6.1 Chrome 插件

```text
Manifest V3
TypeScript
Vite
React 可选
chrome.scripting
chrome.downloads 仅用于导出文件，不负责媒体下载
```

插件只做：

```text
1. 扫描当前页面 article 节点
2. 提取 tweet URL
3. 提取 tweet_id
4. 提取作者、时间、可见文本
5. 标记来源页面：bookmarks / user_media / search / custom
6. 导出 JSONL 和 TXT
```

插件不做：

```text
1. 大规模下载
2. 视频解析
3. HLS / m3u8 处理
4. Postgres 写入
5. 长时间后台任务
6. 大量文件系统管理
```

---

### 6.2 本地 CLI

使用 Python，但通过 Docker 运行，避免 Windows 本机 pip 环境问题。

核心依赖：

```text
typer
rich
pydantic
pydantic-settings
orjson
psycopg[binary]
python-dotenv
gallery-dl
yt-dlp
```

职责：

```text
1. 初始化 archive 目录
2. 导入 tweets.jsonl / tweet_urls.txt
3. 写入 Postgres
4. 生成待下载 URL 文件
5. 调用 gallery-dl / yt-dlp
6. 解析下载后的 metadata / info.json
7. 计算 sha256
8. 更新下载状态
9. 支持 retry / verify / export
```

---

### 6.3 下载引擎

默认使用：

```text
gallery-dl：第一下载器
yt-dlp：视频 / GIF / 失败兜底下载器
```

建议策略：

```text
1. 普通下载先跑 gallery-dl
2. gallery-dl 失败或 metadata 标记为视频时，再跑 yt-dlp
3. 两者都使用 download archive 避免重复下载
4. CLI 通过数据库状态和 download archive 双重去重
```

---

### 6.4 数据库

开发阶段使用 Docker Postgres，生产/个人长期归档环境使用 Supabase 免费额度中的 Postgres。

Postgres 只存元数据，不存媒体文件。

环境策略：

```text
dev:
  使用 docker-compose 中的 postgres 服务
  便于本地调试、清库、跑迁移、验证状态机

prod:
  使用 Supabase Postgres
  便于长期保存 metadata、跨设备查看和备份

test:
  可使用独立 Docker Postgres database 或 schema
```

保存内容：

```text
1. tweet 基础信息
2. source 来源信息
3. media 文件信息
4. 本地路径
5. sha256
6. 下载状态
7. 失败原因
8. job 和 attempt 记录
```

不保存：

```text
1. 大体积图片
2. 大体积视频
3. cookies
4. access token
5. X 内部接口 token
```

---

## 7. 目录结构设计

```text
archive/
  raw/
    imports/
      bookmarks_2026-05-26.jsonl
      user_media_xxx_2026-05-26.jsonl
      tweet_urls_2026-05-26.txt

    downloader_inputs/
      gallery-dl-input.txt
      yt-dlp-input.txt

  media/
    <author_username>/
      <tweet_id>/
        <tweet_id>--m01.jpg
        <tweet_id>--m02.jpg
        <tweet_id>--m03.mp4
        info.json
        tweet.json
        gallery-dl-metadata.json
        yt-dlp-info.json

  state/
    gallery-dl-downloaded.txt
    yt-dlp-downloaded.txt
    failures.csv
    checkpoints.json

  logs/
    import_2026-05-26.log
    download_2026-05-26.log

  exports/
    tweets.csv
    media.csv
    report.html
```

单条 tweet 示例：

```text
archive/
  media/
    nasa/
      1791234567890123456/
        1791234567890123456--m01.jpg
        1791234567890123456--m02.mp4
        tweet.json
        info.json
```

---

## 8. 插件导出格式

### 8.1 tweets.jsonl

每一行一个 tweet：

```json
{
  "tweet_id": "1791234567890123456",
  "url": "https://x.com/user/status/1791234567890123456",
  "author_username": "user",
  "author_display_name": "User Name",
  "datetime": "2026-05-26T01:23:45.000Z",
  "text": "tweet visible text...",
  "source_type": "bookmarks",
  "source_url": "https://x.com/i/bookmarks",
  "collected_at": "2026-05-26T06:00:00.000Z"
}
```

注意：这里**不包含媒体直链**。

---

### 8.2 tweet_urls.txt

```text
https://x.com/user/status/1791234567890123456
https://x.com/user/status/1791234567890123457
https://x.com/user/status/1791234567890123458
```

---

## 9. Postgres 表设计

### 9.1 archive_sources

```sql
create table if not exists archive_sources (
  id bigserial primary key,
  source_type text not null,
  source_url text,
  label text,
  created_at timestamptz not null default now()
);

create index if not exists idx_archive_sources_source_type
on archive_sources(source_type);
```

---

### 9.2 tweets

```sql
create table if not exists tweets (
  tweet_id text primary key,
  url text not null,
  author_username text,
  author_display_name text,
  published_at timestamptz,
  text text,
  source_type text,
  source_url text,
  collected_at timestamptz,
  imported_at timestamptz not null default now(),
  download_status text not null default 'pending',
  raw_import jsonb,
  last_error text,
  retry_count int not null default 0,
  last_attempt_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint chk_tweets_download_status check (
    download_status in (
      'pending',
      'downloading',
      'downloaded',
      'partial',
      'failed_retryable',
      'failed_permanent',
      'verified',
      'missing',
      'corrupt',
      'skipped'
    )
  )
);

create index if not exists idx_tweets_author_username
on tweets(author_username);

create index if not exists idx_tweets_download_status
on tweets(download_status);

create index if not exists idx_tweets_published_at
on tweets(published_at);
```

---

### 9.3 media_assets

```sql
create table if not exists media_assets (
  id bigserial primary key,
  tweet_id text not null references tweets(tweet_id) on delete cascade,
  media_index int,
  media_type text,
  local_path text,
  original_filename text,
  file_ext text,
  file_size bigint,
  sha256 text,
  width int,
  height int,
  duration_ms int,
  source_engine text,
  metadata_path text,
  download_status text not null default 'pending',
  error_message text,
  raw_metadata jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_media_assets_download_status check (
    download_status in (
      'pending',
      'downloading',
      'downloaded',
      'failed_retryable',
      'failed_permanent',
      'verified',
      'missing',
      'corrupt',
      'skipped'
    )
  )
);

create unique index if not exists uq_media_assets_tweet_index_engine
on media_assets(tweet_id, media_index, source_engine)
where media_index is not null and source_engine is not null;

create unique index if not exists uq_media_assets_local_path
on media_assets(local_path)
where local_path is not null;

create index if not exists idx_media_assets_tweet_id
on media_assets(tweet_id);

create index if not exists idx_media_assets_status
on media_assets(download_status);

create index if not exists idx_media_assets_sha256
on media_assets(sha256);

create index if not exists idx_media_assets_source_engine
on media_assets(source_engine);
```

说明：

```text
media_assets 不提前保存 remote_url。
media_assets 由 gallery-dl / yt-dlp 下载完成后，根据本地文件和 metadata 回填。
sha256 只建索引，不做唯一约束，因为转发、重复媒体、封面图可能产生相同 hash。
如果后续决定两个下载引擎只保留一个最终资产记录，可将唯一约束调整为 unique(tweet_id, media_index)。
```

---

### 9.4 download_jobs

```sql
create table if not exists download_jobs (
  id bigserial primary key,
  job_type text not null,
  engine text,
  input_path text,
  status text not null default 'pending',
  total_count int not null default 0,
  success_count int not null default 0,
  failed_count int not null default 0,
  started_at timestamptz,
  finished_at timestamptz,
  error_message text,
  created_at timestamptz not null default now()
);

create index if not exists idx_download_jobs_status
on download_jobs(status);

create index if not exists idx_download_jobs_engine
on download_jobs(engine);
```

---

### 9.5 download_attempts

```sql
create table if not exists download_attempts (
  id bigserial primary key,
  job_id bigint references download_jobs(id) on delete set null,
  tweet_id text references tweets(tweet_id) on delete cascade,
  media_asset_id bigint references media_assets(id) on delete set null,
  engine text not null,
  status text not null,
  exit_code int,
  error_category text,
  error_message text,
  stderr_excerpt text,
  duration_ms int,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create index if not exists idx_download_attempts_tweet_id
on download_attempts(tweet_id);

create index if not exists idx_download_attempts_job_id
on download_attempts(job_id);

create index if not exists idx_download_attempts_engine
on download_attempts(engine);
```

---

## 10. CLI 命令设计

```bash
xarchiver init
xarchiver db migrate
xarchiver import ./tweets.jsonl
xarchiver import-urls ./tweet_urls.txt
xarchiver status
xarchiver download
xarchiver download --engine gallery-dl
xarchiver download --engine yt-dlp
xarchiver retry
xarchiver verify
xarchiver export --format csv
```

---

## 11. 状态机与幂等性设计

### 11.1 tweet 下载状态

`tweets.download_status` 使用固定状态集合：

```text
pending             已导入，等待下载
downloading         当前 job 正在处理
downloaded          已下载到至少一个有效媒体文件
partial             部分媒体下载成功，部分失败
failed_retryable    网络错误、429、5xx、timeout 等可重试失败
failed_permanent    404、权限不可见、tweet 删除、cookies 无权访问等永久失败
verified            文件存在且 sha256 校验通过
missing             数据库记录存在，但本地文件缺失
corrupt             文件存在但大小为 0 或 sha256 不匹配
skipped             用户显式跳过或规则排除
```

允许的主要状态流转：

```text
pending -> downloading -> downloaded -> verified
pending -> downloading -> partial -> failed_retryable
pending -> downloading -> failed_retryable
pending -> downloading -> failed_permanent
downloaded -> missing
downloaded -> corrupt
missing -> pending
corrupt -> pending
failed_retryable -> downloading
```

### 11.2 media 下载状态

`media_assets.download_status` 使用同一套语义，但以单个媒体文件为粒度：

```text
pending / downloading / downloaded / failed_retryable / failed_permanent / verified / missing / corrupt
```

tweet 状态由 media 状态汇总：

```text
1. 所有媒体 verified，则 tweet 为 verified
2. 至少一个媒体 downloaded/verified 且存在失败媒体，则 tweet 为 partial
3. 没有媒体成功且失败可重试，则 tweet 为 failed_retryable
4. 没有媒体成功且失败不可重试，则 tweet 为 failed_permanent
```

### 11.3 幂等性规则

```text
1. import 重复运行只 upsert tweet 基础信息，不把 downloaded / verified 重置为 pending
2. import --force-status 才允许显式重置状态
3. download 默认只处理 pending / failed_retryable / missing / corrupt
4. retry 只处理 failed_retryable 且 retry_count < retry_limit 的记录
5. verify 只改变 downloaded / verified / missing / corrupt，不触发下载
6. 每次 download / retry 都创建 download_jobs 记录
7. 每条 tweet 在每个引擎下至少创建一条 download_attempts 记录
8. 每个 attempt 记录 exit_code、stderr 摘要、错误分类和耗时
9. 重复运行 download 不应重复下载已在数据库和 download archive 中确认完成的 tweet
10. --force-download 才允许忽略状态和 download archive 重新尝试
```

---

## 12. CLI 工作流

### 12.1 初始化

```bash
xarchiver init ./archive
xarchiver db migrate
```

初始化内容：

```text
1. 创建 archive 目录
2. 创建 raw/media/state/logs/exports 子目录
3. 连接 Postgres
4. 执行建表 SQL
5. 检查 gallery-dl / yt-dlp 是否可用
```

---

### 12.2 导入 tweets.jsonl

```bash
xarchiver import ./archive/raw/imports/bookmarks_2026-05-26.jsonl
```

行为：

```text
1. 读取 JSONL
2. 按 tweet_id upsert tweets 表
3. 新记录 download_status 设置为 pending
4. 已存在记录不重置 downloaded / verified / failed_permanent
5. 重复导入不会重复创建
```

---

### 12.3 下载

默认流程：

```bash
xarchiver download
```

等价于：

```bash
xarchiver download --engine gallery-dl
xarchiver retry --engine yt-dlp
```

内部流程：

```text
1. 从 tweets 表读取 pending / failed_retryable / missing / corrupt 记录
2. 生成 archive/raw/downloader_inputs/gallery-dl-input.txt
3. 创建 download_jobs 记录
4. 将本批 tweet 状态更新为 downloading
5. 记录下载前的 archive/media 文件快照
6. 调用 gallery-dl
7. 记录下载后的 archive/media 文件快照
8. 解析新增文件、metadata、exit code、stderr
9. 更新 tweets / media_assets / download_attempts
10. 对失败或视频相关任务生成 yt-dlp-input.txt
11. 调用 yt-dlp 兜底
12. 再次更新数据库状态
```

---

### 12.4 重试

```bash
xarchiver retry
xarchiver retry --engine yt-dlp
```

重试对象：

```text
1. download_status = failed_retryable
2. last_error 属于网络错误、429、5xx、timeout
3. 未达到 retry_limit
```

---

### 12.5 校验

```bash
xarchiver verify
```

校验内容：

```text
1. 数据库记录的 local_path 是否存在
2. 文件大小是否为 0
3. sha256 是否匹配
4. tweet 是否存在媒体文件
5. download archive 与数据库状态是否大致一致
```

---

## 13. 下载器输出契约

CLI 不依赖 stdout 作为唯一成功判断，最终以文件存在、metadata、exit code、download archive 和数据库状态综合判断。

### 13.1 统一输出目录

所有下载器必须输出到同一类目录：

```text
archive/media/<author_username>/<tweet_id>/
```

其中 `<author_username>` 优先使用导入阶段采集到的用户名；如果下载器 metadata 中返回了更准确的用户名，可在回填 metadata 时更新，但不移动既有文件，除非执行独立的 normalize 命令。

### 13.2 统一文件命名

媒体文件必须尽量满足：

```text
<tweet_id>--m<media_index>.<ext>
```

示例：

```text
1791234567890123456--m01.jpg
1791234567890123456--m02.mp4
```

命名要求：

```text
1. 文件名必须能反推出 tweet_id
2. 多媒体 tweet 必须能反推出 media_index
3. 不允许同一 tweet 的多个媒体互相覆盖
4. metadata 文件使用固定命名，不参与 media_index
```

metadata 文件命名：

```text
tweet.json
gallery-dl-metadata.json
yt-dlp-info.json
```

### 13.3 文件映射规则

CLI 回填 `media_assets` 时按以下顺序建立映射：

```text
1. 优先使用文件路径中的 tweet_id
2. 再使用文件名中的 tweet_id 和 media_index
3. 再使用下载器 metadata / info.json 中的 id、tweet_id、playlist_index 等字段
4. 最后才使用本次 job 的输入 URL 和下载前后文件快照做兜底
```

如果无法确定 tweet_id，文件进入：

```text
archive/media/_unmatched/<job_id>/
```

并在 `download_attempts.error_message` 中记录 `unmatched_download_output`。

### 13.4 第 0 阶段必须验证的下载器字段

`gallery-dl` / `yt-dlp` 对 X 的模板字段可能随版本变化。第 0 阶段必须验证并固化：

```text
1. gallery-dl 是否支持 tweet_id 字段
2. gallery-dl 是否支持 media 序号字段，如 num / count / index
3. gallery-dl 作者字段实际名称
4. yt-dlp 的 id 是否等于 tweet_id
5. yt-dlp 的 uploader / uploader_id 对 X 是否稳定
6. 多图、多视频、GIF 的 metadata / info.json 结构
```

验证完成后，把实际可用字段写入 `docs/downloader-contract.md`。

---

## 14. gallery-dl 调用设计

基础命令：

```bash
gallery-dl \
  --cookies /app/secrets/cookies.txt \
  --write-metadata \
  --download-archive /app/archive/state/gallery-dl-downloaded.txt \
  -i /app/archive/raw/downloader_inputs/gallery-dl-input.txt
```

建议配置文件：

```json
{
  "extractor": {
    "twitter": {
      "filename": "{tweet_id}--m{num}.{extension}",
      "directory": ["/app", "archive", "media", "{author[name]}", "{tweet_id}"],
      "metadata": true,
      "cookies": "/app/secrets/cookies.txt"
    }
  }
}
```

CLI 负责：

```text
1. 生成 input.txt
2. 执行 gallery-dl
3. 捕获 stdout / stderr / exit code
4. 记录 download_attempts
5. 扫描 archive/media 下的新文件
6. 解析 metadata 并写入 media_assets
7. 如果模板字段不稳定，降级为 CLI 后处理重命名
```

---

## 15. yt-dlp 调用设计

基础命令：

```bash
yt-dlp \
  --cookies /app/secrets/cookies.txt \
  --write-info-json \
  --write-thumbnail \
  --download-archive /app/archive/state/yt-dlp-downloaded.txt \
  -a /app/archive/raw/downloader_inputs/yt-dlp-input.txt \
  -o "/app/archive/media/%(uploader_id)s/%(id)s/%(id)s.%(ext)s"
```

CLI 负责：

```text
1. 生成 yt-dlp-input.txt
2. 执行 yt-dlp
3. 捕获 stdout / stderr / exit code
4. 解析 .info.json
5. 计算 sha256
6. 更新 media_assets
7. 更新 tweets.download_status
8. 必要时将 yt-dlp 原始输出移动或重命名为统一输出契约
```

---

## 16. Windows + Docker 开发方案

由于 Windows 下 Python、pip、虚拟环境、PATH、依赖编译经常带来额外问题，本项目采用 Docker 作为 CLI 运行环境。

Windows 本机只需要安装：

```text
1. Docker Desktop
2. VS Code
3. VS Code Dev Containers 插件
4. Git
5. Chrome / Edge
```

Python、pip、gallery-dl、yt-dlp、ffmpeg 全部放在容器中。

---

## 17. Dockerfile

`cli/Dockerfile`：

```dockerfile
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV PIP_NO_CACHE_DIR=1

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    ca-certificates \
    curl \
    git \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt /app/requirements.txt

RUN pip install --upgrade pip \
    && pip install -r /app/requirements.txt

COPY . /app

ENTRYPOINT ["python", "-m", "xarchiver.cli"]
```

---

## 18. requirements.txt

```txt
typer
rich
pydantic
pydantic-settings
orjson
psycopg[binary]
python-dotenv
gallery-dl
yt-dlp
```

---

## 19. docker-compose.yml

项目根目录：

```yaml
services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_DB: xarchiver
      POSTGRES_USER: xarchiver
      POSTGRES_PASSWORD: xarchiver_dev_password
    ports:
      - "5432:5432"
    volumes:
      - pg_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U xarchiver -d xarchiver"]
      interval: 5s
      timeout: 5s
      retries: 10

  xarchiver:
    build:
      context: ./cli
      dockerfile: Dockerfile
    env_file:
      - .env
    volumes:
      - ./archive:/app/archive
      - ./examples:/app/examples
      - ./cli:/app
      - ./secrets:/app/secrets:ro
    working_dir: /app
    depends_on:
      postgres:
        condition: service_healthy

volumes:
  pg_data:
```

运行示例：

```bash
docker compose run --rm xarchiver init /app/archive
docker compose run --rm xarchiver db migrate
docker compose run --rm xarchiver import /app/archive/raw/imports/tweets.jsonl
docker compose run --rm xarchiver download --engine gallery-dl
docker compose run --rm xarchiver retry --engine yt-dlp
docker compose run --rm xarchiver status
```

---

## 20. cookies 处理方案

### 20.1 问题

`--cookies-from-browser chrome` 在 Windows 本机直接运行时比较方便，但在 Linux 容器中可能无法直接读取 Windows Chrome 的 cookie 数据库。

### 20.2 推荐方案

MVP 推荐使用 `cookies.txt` 文件挂载进容器。
Docker 模式只支持 `COOKIE_FILE=/app/secrets/cookies.txt`。
`--cookies-from-browser chrome` 仅作为非 Docker 本机运行时的可选模式，不进入 MVP 默认路径。

目录：

```text
secrets/
  cookies.txt
```

命令：

```bash
gallery-dl \
  --cookies /app/secrets/cookies.txt \
  --write-metadata \
  --download-archive /app/archive/state/gallery-dl-downloaded.txt \
  -i /app/archive/raw/downloader_inputs/gallery-dl-input.txt
```

```bash
yt-dlp \
  --cookies /app/secrets/cookies.txt \
  --write-info-json \
  --write-thumbnail \
  --download-archive /app/archive/state/yt-dlp-downloaded.txt \
  -a /app/archive/raw/downloader_inputs/yt-dlp-input.txt \
  -o "/app/archive/media/%(uploader_id)s/%(id)s/%(id)s.%(ext)s"
```

安全要求：

```text
1. secrets/ 必须加入 .gitignore
2. 不把 cookies.txt 上传 GitHub
3. 不把 cookies 内容写入 Postgres
4. 日志中不打印 cookies
5. cookies 失效时提示用户重新导出
```

---

## 21. .env 示例

开发环境 `.env`：

```env
DATABASE_URL=postgresql://xarchiver:xarchiver_dev_password@postgres:5432/xarchiver
ARCHIVE_DIR=/app/archive
COOKIE_FILE=/app/secrets/cookies.txt
DEFAULT_DOWNLOAD_ENGINE=gallery-dl
RETRY_LIMIT=3
```

生产环境 `.env.production`：

```env
DATABASE_URL=postgresql://postgres.xxxxx:YOUR_PASSWORD@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres
ARCHIVE_DIR=/app/archive
COOKIE_FILE=/app/secrets/cookies.txt
DEFAULT_DOWNLOAD_ENGINE=gallery-dl
RETRY_LIMIT=3
```

---

## 22. GitHub 仓库结构

```text
x-media-archiver/
  README.md
  LICENSE
  .gitignore
  docker-compose.yml
  .env.example

  extension/
    manifest.json
    package.json
    vite.config.ts
    src/
      content/
        scanTweets.ts
        extractTweet.ts
      popup/
        Popup.tsx
      background/
        serviceWorker.ts
      utils/
        exportJsonl.ts
        exportTxt.ts

  cli/
    Dockerfile
    requirements.txt
    pyproject.toml
    xarchiver/
      __init__.py
      cli.py
      db.py
      migrations.py
      importer.py
      downloader.py
      gallerydl.py
      ytdlp.py
      verifier.py
      exporter.py
      config.py
      models.py

  sql/
    001_init.sql

  docs/
    architecture.md
    install.md
    usage.md
    troubleshooting.md
    data-schema.md
    downloader-contract.md

  examples/
    tweets.example.jsonl
    tweet_urls.example.txt
    config.example.yaml

  archive/
    .gitkeep

  secrets/
    .gitkeep
```

---

## 23. 插件模块设计

```text
extension/
  src/
    content/
      scanTweets.ts
      extractTweet.ts
    popup/
      Popup.tsx
    utils/
      exportJsonl.ts
      exportTxt.ts
```

### 23.1 scanTweets.ts 职责

```text
1. 查找 article
2. 提取 status URL
3. 提取 tweet_id
4. 提取 username
5. 提取 display name
6. 提取 time[datetime]
7. 提取可见文本
8. 去重
9. 维护已扫描 tweet_id Set
10. 记录扫描统计和异常
```

### 23.2 Popup 功能

```text
[Scan Current Page]
[Start Auto Scroll Scan]
[Stop]
[Export tweet_urls.txt]
[Export tweets.jsonl]
[Clear]
```

### 23.3 自动滚动扫描边界

```text
1. 每轮滚动后等待 article 数量或页面高度稳定
2. 使用 tweet_id Set 去重，避免虚拟列表反复挂载造成重复
3. 支持 max_scroll_count
4. 支持 max_empty_rounds，连续多轮无新增 tweet 后停止
5. 支持手动 Stop
6. 导出 JSONL 时附带 scan_stats 文件
```

`scan_stats.json` 示例：

```json
{
  "source_url": "https://x.com/i/bookmarks",
  "source_type": "bookmarks",
  "started_at": "2026-05-26T06:00:00.000Z",
  "finished_at": "2026-05-26T06:10:00.000Z",
  "scroll_count": 120,
  "seen_article_count": 980,
  "unique_tweet_count": 640,
  "duplicate_count": 340,
  "empty_rounds": 5
}
```

---

## 24. MVP 范围

### V0.1 必须实现

```text
extension:
  - 扫描当前页面 tweet
  - 自动滚动扫描
  - 导出 tweet_urls.txt
  - 导出 tweets.jsonl

cli:
  - Docker 化运行
  - 开发环境连接 Docker Postgres
  - 生产环境连接 Supabase Postgres
  - 执行建表迁移
  - 导入 tweets.jsonl
  - 调用 gallery-dl
  - 调用 yt-dlp 兜底
  - 写入 tweets / jobs / attempts
  - 基础 status
```

### V0.1 不做

```text
1. 不做 direct URL downloader
2. 不做浏览器插件内下载
3. 不做 Supabase Storage
4. 不做 Web UI
5. 不做 Playwright 自动登录扫描
6. 不做官方 API
7. 不做 Twikit
```

---

## 25. 开发里程碑

### 第 0 阶段：下载链路验证，1 天

任务：

```text
1. 准备 Docker 环境
2. 准备 cookies.txt
3. 手动准备 10 条 tweet URL
4. 在容器中测试 gallery-dl
5. 在容器中测试 yt-dlp
6. 确认图片、多图、视频、GIF 至少各成功一个
7. 验证 gallery-dl / yt-dlp 的输出模板字段
8. 固化 docs/downloader-contract.md
```

验收标准：

```text
1. gallery-dl 能通过 cookies.txt 下载 X 图片
2. yt-dlp 能通过 cookies.txt 下载 X 视频
3. archive/media 下生成文件
4. 能生成 metadata / info.json
5. 文件路径可反推出 tweet_id
6. 多媒体 tweet 可反推出 media_index
7. 记录实际可用的 gallery-dl / yt-dlp 字段
```

---

### 第 1 阶段：Docker Postgres + 迁移，1 天

任务：

```text
1. 在 docker-compose 中启动 postgres 服务
2. 使用开发 DATABASE_URL 连接 Docker Postgres
3. 编写 001_init.sql
4. CLI 执行 db migrate
5. 验证 tweets 表可写入
6. 验证唯一约束和状态枚举
```

验收标准：

```text
1. Docker CLI 可以连接 Docker Postgres
2. tweets 表创建成功
3. media_assets 唯一约束创建成功
4. import 后 Postgres 中能看到 tweet 记录
5. 后续切换 DATABASE_URL 即可连接 Supabase
```

---

### 第 2 阶段：Chrome 插件 MVP，2 到 3 天

任务：

```text
1. 建立 extension 项目
2. 实现 scanTweets
3. 实现 auto scroll
4. 实现导出 tweet_urls.txt
5. 实现导出 tweets.jsonl
```

验收标准：

```text
1. bookmarks 页面可以扫描出 tweet URL
2. 用户 media 页面可以扫描出 tweet URL
3. 导出的 JSONL 可被 CLI 导入
4. 重复扫描不会产生大量重复 tweet
5. 自动滚动到 max_empty_rounds 后能自动停止
6. scan_stats 能反映扫描结果
```

---

### 第 3 阶段：CLI MVP，3 到 5 天

任务：

```text
1. xarchiver init
2. xarchiver db migrate
3. xarchiver import
4. xarchiver status
5. xarchiver download --engine gallery-dl
6. xarchiver retry --engine yt-dlp
```

验收标准：

```text
1. 可以导入 tweets.jsonl
2. 可以生成 downloader input
3. 可以调用 gallery-dl
4. 可以调用 yt-dlp
5. 失败任务可重试
6. 已下载任务不会重复下载
7. 状态流转符合状态机设计
8. download_jobs / download_attempts 记录完整
```

---

### 第 4 阶段：归档规范化，3 到 5 天

任务：

```text
1. 统一目录结构
2. 统一文件命名
3. 生成 tweet.json
4. 生成 media.csv
5. 生成 tweets.csv
6. 计算 sha256
7. 检查缺失文件
8. 回填 media_assets 表
```

验收标准：

```text
1. 每条 tweet 有独立目录
2. 多媒体 tweet 不覆盖文件
3. CSV 可以被 Excel / pandas 读取
4. Postgres 状态与本地文件一致
```

---

### 第 5 阶段：稳定性增强，5 到 7 天

任务：

```text
1. 下载并发控制
2. 失败分类
3. 429 / 403 / 404 / 5xx 分类处理
4. 日志系统
5. 中断恢复
6. 任务进度条
7. 配置文件
```

验收标准：

```text
1. 中断后重新运行可以继续
2. 网络失败不会导致整个任务崩溃
3. 失败原因能在 failures.csv 和 download_attempts 中看到
4. 重复运行不会重复下载
```

---

## 26. 配置文件示例

配置优先级：

```text
CLI 参数 > 环境变量 > config.yaml > 默认值
```

`config.example.yaml`：

```yaml
archive_dir: "/app/archive"
database_url_env: "DATABASE_URL"

cookies:
  mode: "file"
  file: "/app/secrets/cookies.txt"

download:
  default_engine: "gallery-dl"
  fallback_engine: "yt-dlp"
  concurrency: 2
  retry_limit: 3
  sleep_seconds: 2

gallery_dl:
  enabled: true
  download_archive: "/app/archive/state/gallery-dl-downloaded.txt"
  input_file: "/app/archive/raw/downloader_inputs/gallery-dl-input.txt"

yt_dlp:
  enabled: true
  download_archive: "/app/archive/state/yt-dlp-downloaded.txt"
  input_file: "/app/archive/raw/downloader_inputs/yt-dlp-input.txt"

naming:
  pattern: "{author_username}/{tweet_id}/{tweet_id}--m{index}"

safety:
  respect_rate_limits: true
  save_cookies_to_db: false
  log_sensitive_values: false
```

---

## 27. README 首版结构

```text
# x-media-archiver

A local-first X/Twitter media archiver.

## Features

- Export tweet URLs from X pages using Chrome extension
- Archive bookmarks / user media pages
- Download images, videos, GIFs
- Save tweet metadata to Postgres
- Use Docker Postgres for development
- Use Supabase Postgres for production / long-term archive
- Store media files locally
- Resume interrupted jobs
- Avoid duplicate downloads
- Use gallery-dl and yt-dlp as download engines

## What this project does not do

- Does not bypass login
- Does not bypass rate limits
- Does not share cookies or tokens
- Does not provide proxy pool or account rotation

## Quick Start

1. Install the extension
2. Open X bookmarks or user media page
3. Scan and export tweets.jsonl
4. Put cookies.txt under secrets/
5. Run Docker CLI
6. Import tweets
7. Download media

## Warning

This tool is intended for personal archiving of content you are allowed to access.
Respect X/Twitter terms, copyright, privacy, and rate limits.
```

---

## 28. 风险与应对

### 风险 1：X 页面结构变化

应对：

```text
1. 插件只做轻量 DOM 提取
2. 提取逻辑集中在 extractTweet.ts
3. 尽量只依赖 article、status URL、time[datetime]
4. 不依赖复杂 React 内部状态
```

---

### 风险 2：gallery-dl / yt-dlp 某天失效

应对：

```text
1. 下载器做成 adapter
2. 保留 tweet URL 和原始 metadata
3. 等待工具社区修复
4. 临时切换另一个下载器
5. 后续可选增加 Playwright / 官方 API / Twikit，但不进入 MVP
```

---

### 风险 3：cookies 失效

应对：

```text
1. 提示用户重新登录浏览器
2. 重新导出 cookies.txt
3. 下载失败时识别 401 / 403
4. 不保存明文 cookies 到项目目录以外的位置
5. 不写入 Supabase
```

---

### 风险 4：重复下载

应对：

```text
1. Postgres tweets.download_status
2. gallery-dl download archive
3. yt-dlp download archive
4. sha256 去重
5. local_path 唯一检查
```

---

### 风险 5：Supabase 免费额度限制

应对：

```text
1. 生产环境 Supabase 只存 metadata
2. 媒体文件保存在本地
3. raw_metadata 控制大小
4. 大规模归档时定期 export CSV
5. 开发和验证阶段使用 Docker Postgres
6. 后续可迁移到自建 Postgres
```

---

### 风险 6：Windows 容器读取浏览器 cookies 困难

应对：

```text
1. MVP 使用 cookies.txt
2. cookies.txt 通过 secrets/ 挂载进容器
3. secrets/ 加入 .gitignore
4. 不依赖 --cookies-from-browser chrome
```

---

## 29. 安全与合规边界

本项目必须明确：

```text
1. 仅用于个人归档或你有权访问/保存的内容
2. 不提供绕过登录、绕过限制、批量盗抓私密内容的功能
3. 不共享 cookies / tokens
4. 不提供代理池、风控规避、账号轮换能力
5. 尊重版权、隐私和平台规则
6. 避免高频请求和破坏性抓取
7. 不把 cookies、token、session 写入数据库或日志
```

---

## 30. 最终版本路线图

```text
V0.1
插件导出 tweet URL + Docker CLI + Docker Postgres + gallery-dl / yt-dlp 下载

V0.2
Supabase 生产配置 + 失败重试 + 去重 + 完整 download_attempts

V0.3
完整 metadata 归档 + media_assets 回填 + CSV 导出

V0.4
Playwright 枚举器，可替代插件

V0.5
本地 Web UI，只读查看归档

V1.0
稳定版：插件 + Docker CLI + Docker/Supabase Postgres + gallery-dl + yt-dlp + 完整文档
```

---

## 31. 立即开始的第一步

不要先写插件。先验证下载链路。

准备：

```text
1. Docker Desktop
2. Docker Postgres
3. cookies.txt
4. 10 条 tweet URL
```

先跑：

```bash
docker compose run --rm xarchiver db migrate
docker compose run --rm xarchiver import-urls /app/examples/tweet_urls.example.txt
docker compose run --rm xarchiver download --engine gallery-dl
docker compose run --rm xarchiver retry --engine yt-dlp
```

验收：

```text
1. Docker Postgres tweets 表有记录
2. archive/media 下有文件
3. gallery-dl-downloaded.txt / yt-dlp-downloaded.txt 有记录
4. 失败原因能进入 download_attempts
5. 文件命名和 metadata 满足下载器输出契约
```

完成这一步后，再开始 Chrome 插件。
