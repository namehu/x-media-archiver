drop index if exists uq_archive_run_items_active_tweet;

create unique index uq_archive_run_items_active_tweet
on archive_run_items(tweet_id)
where status in ('pending', 'processing', 'failed_retryable');
