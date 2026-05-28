alter table source_scan_runs
drop constraint if exists chk_source_scan_runs_status;

alter table source_scan_runs
add constraint chk_source_scan_runs_status check (
  status in (
    'running',
    'waiting_downloads',
    'succeeded',
    'completed_empty_batch',
    'completed_end_of_source',
    'rate_limited',
    'auth_required',
    'network_error',
    'failed'
  )
);
