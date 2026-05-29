alter table archive_run_items
add column if not exists worker_id text,
add column if not exists lease_expires_at timestamptz,
add column if not exists claimed_at timestamptz;

alter table source_scan_runs
add column if not exists worker_id text,
add column if not exists lease_expires_at timestamptz,
add column if not exists claimed_at timestamptz;

create unique index if not exists archive_run_items_running_uniq
on archive_run_items(id)
where status = 'processing';

drop index if exists source_scan_runs_running_uniq;

create unique index source_scan_runs_running_uniq
on source_scan_runs(source_id)
where status = 'running';
