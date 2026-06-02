from alembic import op

revision = "002_add_cookie_config"
down_revision = "001_initial_schema"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        create table if not exists cookie_config (
          id smallint primary key default 1,
          content text,
          label text,
          updated_at timestamptz not null default now(),
          constraint chk_cookie_config_singleton check (id = 1)
        );

        insert into cookie_config (id, content, label)
        values (1, null, null)
        on conflict (id) do nothing;
        """
    )


def downgrade() -> None:
    op.execute("drop table if exists cookie_config cascade;")
