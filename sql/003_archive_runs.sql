create table if not exists archive_runs (
  id bigserial primary key,
  trigger_type text not null,
  input_path text,
  status text not null default 'running',
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  result jsonb,
  error_message text,
  constraint chk_archive_runs_status check (status in ('running', 'completed', 'failed'))
);

create index if not exists idx_archive_runs_status
on archive_runs(status);

create index if not exists idx_archive_runs_started_at
on archive_runs(started_at desc);

alter table inbox_imports
add column if not exists archive_run_id bigint references archive_runs(id) on delete set null;

create index if not exists idx_inbox_imports_archive_run_id
on inbox_imports(archive_run_id);
