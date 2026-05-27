create table if not exists inbox_imports (
  id bigserial primary key,
  file_path text not null,
  filename text not null,
  file_type text not null,
  file_size bigint not null,
  sha256 text not null unique,
  status text not null default 'pending',
  discovered_at timestamptz not null default now(),
  processing_started_at timestamptz,
  processed_at timestamptz,
  error_message text,
  result jsonb,
  constraint chk_inbox_imports_file_type check (file_type in ('urls', 'jsonl')),
  constraint chk_inbox_imports_status check (
    status in ('pending', 'processing', 'completed', 'failed')
  )
);

create index if not exists idx_inbox_imports_status
on inbox_imports(status);

create index if not exists idx_inbox_imports_discovered_at
on inbox_imports(discovered_at desc);

create table if not exists inbox_scheduler_settings (
  id smallint primary key default 1,
  enabled boolean not null default false,
  interval_minutes int not null default 15,
  last_scan_at timestamptz,
  next_scan_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint chk_inbox_scheduler_singleton check (id = 1),
  constraint chk_inbox_scheduler_interval check (interval_minutes >= 1)
);

insert into inbox_scheduler_settings (id, enabled, interval_minutes)
values (1, false, 15)
on conflict (id) do nothing;
