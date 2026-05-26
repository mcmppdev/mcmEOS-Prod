-- Home calendar tasks and organisation settings for quote generation.

create table if not exists public.tasks (
  task_id text primary key,
  title text not null,
  due_date date not null,
  status text not null default 'Open',
  priority text not null default 'Normal',
  assigned_user_id text references public.app_users(user_id),
  source_type text,
  source_id text,
  source_label text,
  notes text,
  created_by_user_id text references public.app_users(user_id),
  created_by_name text,
  updated_by_user_id text references public.app_users(user_id),
  updated_by_name text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_tasks_due_date on public.tasks(due_date);
create index if not exists idx_tasks_assigned_user on public.tasks(assigned_user_id);
create index if not exists idx_tasks_status on public.tasks(status);

drop trigger if exists set_tasks_updated_at on public.tasks;
create trigger set_tasks_updated_at before update on public.tasks
for each row execute function public.set_updated_at();

create table if not exists public.organisation (
  organisation_id text primary key,
  company_name text not null default 'MCM Paper Products',
  address text,
  gst_number text,
  logo_url text,
  is_active boolean not null default true,
  created_by_user_id text references public.app_users(user_id),
  created_by_name text,
  updated_by_user_id text references public.app_users(user_id),
  updated_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists organisation_one_active_idx
on public.organisation ((is_active))
where is_active = true;

drop trigger if exists set_organisation_updated_at on public.organisation;
create trigger set_organisation_updated_at before update on public.organisation
for each row execute function public.set_updated_at();

insert into public.organisation (organisation_id, company_name, address, gst_number, logo_url, is_active)
values ('ORG-DEFAULT', 'MCM Paper Products', '', '', './assets/mcm-logo-cropped.png', true)
on conflict (organisation_id) do nothing;
