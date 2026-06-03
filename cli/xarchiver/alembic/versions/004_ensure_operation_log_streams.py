from alembic import op

revision = "004_ensure_operation_log_streams"
down_revision = "003_add_source_scan_progress"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        create table if not exists operation_log_streams (
          id bigserial primary key,
          scope_type text not null,
          scope_id bigint not null,
          log_path text not null,
          metadata jsonb not null default '{}'::jsonb,
          line_count int not null default 0,
          byte_size bigint not null default 0,
          level_counts jsonb not null default '{}'::jsonb,
          last_level text,
          last_message text,
          last_log_at timestamptz,
          is_truncated boolean not null default false,
          created_at timestamptz not null default now(),
          closed_at timestamptz
        );

        create index if not exists idx_operation_log_streams_scope
        on operation_log_streams(scope_type, scope_id);

        create index if not exists idx_operation_log_streams_last_log
        on operation_log_streams(coalesce(last_log_at, created_at) desc, id desc);

        create index if not exists idx_operation_log_streams_metadata_source
        on operation_log_streams((metadata->>'source_id'));

        alter table source_scan_runs
          add column if not exists progress_message text,
          add column if not exists log_stream_id bigint references operation_log_streams(id),
          add column if not exists last_log_at timestamptz,
          drop column if exists log_tail,
          drop column if exists log_path;

        create index if not exists idx_source_scan_runs_log_stream
        on source_scan_runs(log_stream_id);
        """
    )


def downgrade() -> None:
    op.execute(
        """
        alter table source_scan_runs
          drop column if exists last_log_at,
          drop column if exists log_stream_id,
          drop column if exists progress_message;
        drop table if exists operation_log_streams cascade;
        """
    )
