-- Durable app sessions for web login state.
create table if not exists public.app_sessions (
  session_id text primary key,
  user_id text not null references public.app_users(user_id) on delete cascade,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  ip_address text,
  user_agent text
);

create index if not exists idx_app_sessions_user_id
  on public.app_sessions(user_id);

create index if not exists idx_app_sessions_expires_at
  on public.app_sessions(expires_at);

create index if not exists idx_app_sessions_active
  on public.app_sessions(session_id, user_id)
  where revoked_at is null;

-- Helper cleanup query for cron/manual scheduling.
-- Example:
--   select public.prune_app_sessions(30);
create or replace function public.prune_app_sessions(retention_days integer default 30)
returns integer
language plpgsql
as $$
declare
  deleted_count integer;
begin
  delete from public.app_sessions
  where (expires_at < now() or revoked_at is not null)
    and created_at < now() - make_interval(days => retention_days);

  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;
