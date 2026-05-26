-- Machine maintenance logs, optional schedules, and cost tracking.

create table if not exists public.machine_maintenance (
  maintenance_id text primary key,
  machine_id text references public.machines(machine_id),
  machine_name_snapshot text,
  maintenance_date date not null,
  next_due_date date,
  maintenance_type text,
  status text not null default 'Scheduled',
  priority text not null default 'Normal',
  performed_by text,
  downtime_hours numeric(12, 2) not null default 0,
  spare_parts_cost numeric(14, 2) not null default 0,
  oil_cost numeric(14, 2) not null default 0,
  repair_cost numeric(14, 2) not null default 0,
  labor_cost numeric(14, 2) not null default 0,
  other_cost numeric(14, 2) not null default 0,
  total_cost numeric(14, 2) not null default 0,
  issue_notes text,
  work_done text,
  parts_used text,
  damage_notes text,
  entered_by_user_id text references public.app_users(user_id),
  last_edited_by_user_id text references public.app_users(user_id),
  created_by_user_id text references public.app_users(user_id),
  created_by_name text,
  updated_by_user_id text references public.app_users(user_id),
  updated_by_name text,
  source_env text not null default coalesce(nullif(current_setting('app.source_env', true), ''), 'prod'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint machine_maintenance_source_env_check check (source_env in ('dev', 'prod')),
  constraint machine_maintenance_status_check check (status in ('Scheduled', 'In Progress', 'Completed', 'Cancelled')),
  constraint machine_maintenance_priority_check check (priority in ('Low', 'Normal', 'High', 'Critical')),
  constraint machine_maintenance_type_check check (maintenance_type in ('Preventive', 'Breakdown', 'Oil Change', 'Spare Parts', 'Machine Damage', 'Electrical', 'Cleaning', 'Other'))
);

create index if not exists machine_maintenance_env_date_idx on public.machine_maintenance (source_env, maintenance_date);
create index if not exists machine_maintenance_env_due_idx on public.machine_maintenance (source_env, next_due_date);
create index if not exists machine_maintenance_env_machine_idx on public.machine_maintenance (source_env, machine_id);
create index if not exists machine_maintenance_env_status_idx on public.machine_maintenance (source_env, status);

drop trigger if exists set_machine_maintenance_updated_at on public.machine_maintenance;
create trigger set_machine_maintenance_updated_at before update on public.machine_maintenance
for each row execute function public.set_updated_at();

insert into public.app_modules (module_key, module_name, module_group, route_path, display_order, is_active)
values ('machine_maintenance', 'Machine Maintenance', 'Factory', '/maintenance', 135, true)
on conflict (module_key) do update set
  module_name = excluded.module_name,
  module_group = excluded.module_group,
  route_path = excluded.route_path,
  display_order = excluded.display_order,
  is_active = excluded.is_active;

insert into public.app_user_module_access (
  user_id,
  module_key,
  can_view,
  can_create,
  can_update,
  can_delete,
  can_edit_own
)
select
  user_id,
  'machine_maintenance',
  true,
  true,
  true,
  true,
  true
from public.app_users
where lower(coalesce(role, '')) = 'super_admin'
on conflict (user_id, module_key) do update set
  can_view = excluded.can_view,
  can_create = excluded.can_create,
  can_update = excluded.can_update,
  can_delete = excluded.can_delete,
  can_edit_own = excluded.can_edit_own;
