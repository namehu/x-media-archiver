-- 已归档推文的状态概览。
select download_status, count(*) as tweet_count
from tweets
group by download_status
order by download_status;

-- 按媒体类型和校验状态统计媒体数量。
select
  coalesce(media_type, 'unknown') as media_type,
  download_status,
  count(*) as asset_count
from media_assets
group by media_type, download_status
order by media_type, download_status;

-- 最近失败或未完成的推文，便于人工排查。
select
  tweet_id,
  url,
  author_username,
  download_status,
  last_error,
  retry_count,
  updated_at
from tweets
where download_status not in ('downloaded', 'verified', 'skipped')
order by updated_at desc
limit 100;

-- 按已校验媒体资源统计，归档贡献最多的账号。
select
  t.author_username,
  count(*) as verified_asset_count,
  sum(m.file_size) as verified_bytes
from media_assets m
join tweets t on t.tweet_id = m.tweet_id
where m.download_status = 'verified'
group by t.author_username
order by verified_bytes desc nulls last, verified_asset_count desc
limit 100;
