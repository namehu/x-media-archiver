"""add source bulk tasks and schedule policies

Revision ID: 017_add_source_bulk_tasks
Revises: 016_add_source_manual_order
"""

from alembic import op

revision = "017_add_source_bulk_tasks"
down_revision = "016_add_source_manual_order"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        create table if not exists source_schedule_policies (
          id bigserial primary key,
          label text not null,
          action text not null,
          frequency_kind text not null,
          interval_minutes int,
          local_time time,
          weekday smallint,
          timezone text not null default 'Asia/Shanghai',
          jitter_seconds int not null default 300,
          max_downloads_per_source int not null default 50,
          max_downloads_per_task int not null default 1000,
          enabled boolean not null default false,
          next_run_at timestamptz,
          last_run_at timestamptz,
          created_at timestamptz not null default now(),
          updated_at timestamptz not null default now(),
          constraint chk_source_schedule_policy_action check (
            action in ('refresh_latest', 'refresh_and_download_new')
          ),
          constraint chk_source_schedule_policy_frequency check (
            frequency_kind in ('interval', 'daily', 'weekly')
          ),
          constraint chk_source_schedule_policy_interval check (
            (frequency_kind = 'interval' and interval_minutes is not null and interval_minutes >= 60)
            or (frequency_kind in ('daily', 'weekly') and local_time is not null)
          ),
          constraint chk_source_schedule_policy_weekday check (
            (frequency_kind <> 'weekly' and weekday is null)
            or (frequency_kind = 'weekly' and weekday between 0 and 6)
          ),
          constraint chk_source_schedule_policy_limits check (
            jitter_seconds >= 0
            and max_downloads_per_source >= 1
            and max_downloads_per_task >= 1
          )
        );

        create index if not exists idx_source_schedule_policies_due
        on source_schedule_policies(enabled, next_run_at)
        where enabled = true;

        create table if not exists source_bulk_tasks (
          id bigserial primary key,
          task_type text not null,
          trigger_type text not null,
          status text not null default 'queued',
          schedule_policy_id bigint references source_schedule_policies(id) on delete set null,
          source_filter jsonb not null default '{}'::jsonb,
          options jsonb not null default '{}'::jsonb,
          total_count int not null default 0,
          error_category text,
          error_message text,
          started_at timestamptz,
          finished_at timestamptz,
          created_at timestamptz not null default now(),
          updated_at timestamptz not null default now(),
          constraint chk_source_bulk_tasks_type check (
            task_type in ('refresh_latest', 'download_missing', 'refresh_and_download_new')
          ),
          constraint chk_source_bulk_tasks_trigger check (
            trigger_type in ('manual', 'scheduled', 'retry')
          ),
          constraint chk_source_bulk_tasks_status check (
            status in (
              'queued', 'running', 'pausing', 'paused', 'blocked',
              'completed', 'completed_with_issues', 'cancelled'
            )
          )
        );

        create index if not exists idx_source_bulk_tasks_status_created
        on source_bulk_tasks(status, created_at, id);

        create index if not exists idx_source_bulk_tasks_schedule
        on source_bulk_tasks(schedule_policy_id, created_at desc);

        create unique index if not exists uq_source_bulk_tasks_active_schedule
        on source_bulk_tasks(schedule_policy_id)
        where schedule_policy_id is not null
          and status in ('queued', 'running', 'pausing', 'paused', 'blocked');

        create table if not exists source_bulk_task_items (
          id bigserial primary key,
          task_id bigint not null references source_bulk_tasks(id) on delete cascade,
          source_id bigint not null references archive_sources(id) on delete restrict,
          position int not null,
          wave_index int not null,
          status text not null default 'queued',
          scan_run_ids bigint[] not null default '{}'::bigint[],
          archive_run_id bigint references archive_runs(id) on delete set null,
          discovered_count int not null default 0,
          new_tweet_count int not null default 0,
          submitted_count int not null default 0,
          skip_reason text,
          error_category text,
          error_message text,
          started_at timestamptz,
          finished_at timestamptz,
          created_at timestamptz not null default now(),
          updated_at timestamptz not null default now(),
          constraint uq_source_bulk_task_item unique (task_id, source_id),
          constraint chk_source_bulk_task_items_status check (
            status in (
              'queued', 'scanning', 'waiting_download', 'downloading',
              'succeeded', 'skipped', 'failed', 'cancelled'
            )
          )
        );

        create index if not exists idx_source_bulk_task_items_task_status
        on source_bulk_task_items(task_id, status, wave_index, position);

        create index if not exists idx_source_bulk_task_items_source
        on source_bulk_task_items(source_id, created_at desc);

        create table if not exists source_schedule_policy_sources (
          policy_id bigint not null references source_schedule_policies(id) on delete cascade,
          source_id bigint not null references archive_sources(id) on delete cascade,
          created_at timestamptz not null default now(),
          primary key (policy_id, source_id)
        );

        create index if not exists idx_source_schedule_policy_sources_source
        on source_schedule_policy_sources(source_id, policy_id);

        alter table source_scan_runs
          add column if not exists source_bulk_task_item_id bigint
            references source_bulk_task_items(id) on delete set null;

        create index if not exists idx_source_scan_runs_bulk_item
        on source_scan_runs(source_bulk_task_item_id, created_at);

        alter table source_discovered_tweets
          add column if not exists first_discovered_scan_run_id bigint
            references source_scan_runs(id) on delete set null;

        create index if not exists idx_source_discovered_tweets_first_scan
        on source_discovered_tweets(first_discovered_scan_run_id, source_id);

        alter table archive_runs
          add column if not exists last_dispatched_at timestamptz;

        create index if not exists idx_archive_runs_dispatch_fairness
        on archive_runs(last_dispatched_at nulls first, started_at, id)
        where status in ('queued', 'running');
        """
    )


def downgrade() -> None:
    op.execute(
        """
        drop index if exists idx_archive_runs_dispatch_fairness;
        alter table archive_runs drop column if exists last_dispatched_at;

        drop index if exists idx_source_discovered_tweets_first_scan;
        alter table source_discovered_tweets drop column if exists first_discovered_scan_run_id;

        drop index if exists idx_source_scan_runs_bulk_item;
        alter table source_scan_runs drop column if exists source_bulk_task_item_id;

        drop table if exists source_schedule_policy_sources;
        drop table if exists source_bulk_task_items;
        drop index if exists uq_source_bulk_tasks_active_schedule;
        drop table if exists source_bulk_tasks;
        drop table if exists source_schedule_policies;
        """
    )
