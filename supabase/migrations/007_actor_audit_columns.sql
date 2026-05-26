-- Actor audit columns for create/update attribution.
-- Adds who created/updated each row (user id + display name snapshot).

-- Core CRM tables
alter table public.contacts
  add column if not exists created_by_user_id text references public.app_users(user_id),
  add column if not exists created_by_name text,
  add column if not exists updated_by_user_id text references public.app_users(user_id),
  add column if not exists updated_by_name text;

alter table public.accounts
  add column if not exists created_by_user_id text references public.app_users(user_id),
  add column if not exists created_by_name text,
  add column if not exists updated_by_user_id text references public.app_users(user_id),
  add column if not exists updated_by_name text;

alter table public.leads
  add column if not exists created_by_user_id text references public.app_users(user_id),
  add column if not exists created_by_name text,
  add column if not exists updated_by_user_id text references public.app_users(user_id),
  add column if not exists updated_by_name text;

alter table public.sales
  add column if not exists created_by_user_id text references public.app_users(user_id),
  add column if not exists created_by_name text,
  add column if not exists updated_by_user_id text references public.app_users(user_id),
  add column if not exists updated_by_name text;

alter table public.customer_payments
  add column if not exists created_by_user_id text references public.app_users(user_id),
  add column if not exists created_by_name text,
  add column if not exists updated_by_user_id text references public.app_users(user_id),
  add column if not exists updated_by_name text;

-- Product and procurement tables
alter table public.products
  add column if not exists created_by_user_id text references public.app_users(user_id),
  add column if not exists created_by_name text,
  add column if not exists updated_by_user_id text references public.app_users(user_id),
  add column if not exists updated_by_name text;

alter table public.product_prices
  add column if not exists created_by_user_id text references public.app_users(user_id),
  add column if not exists created_by_name text,
  add column if not exists updated_by_user_id text references public.app_users(user_id),
  add column if not exists updated_by_name text;

alter table public.materials
  add column if not exists created_by_user_id text references public.app_users(user_id),
  add column if not exists created_by_name text,
  add column if not exists updated_by_user_id text references public.app_users(user_id),
  add column if not exists updated_by_name text;

alter table public.vendors
  add column if not exists created_by_user_id text references public.app_users(user_id),
  add column if not exists created_by_name text,
  add column if not exists updated_by_user_id text references public.app_users(user_id),
  add column if not exists updated_by_name text;

alter table public.material_purchases
  add column if not exists created_by_user_id text references public.app_users(user_id),
  add column if not exists created_by_name text,
  add column if not exists updated_by_user_id text references public.app_users(user_id),
  add column if not exists updated_by_name text;

alter table public.vendor_payments
  add column if not exists created_by_user_id text references public.app_users(user_id),
  add column if not exists created_by_name text,
  add column if not exists updated_by_user_id text references public.app_users(user_id),
  add column if not exists updated_by_name text;

alter table public.material_stock
  add column if not exists created_by_user_id text references public.app_users(user_id),
  add column if not exists created_by_name text,
  add column if not exists updated_by_user_id text references public.app_users(user_id),
  add column if not exists updated_by_name text;

-- Production and resource tables
alter table public.machines
  add column if not exists created_by_user_id text references public.app_users(user_id),
  add column if not exists created_by_name text,
  add column if not exists updated_by_user_id text references public.app_users(user_id),
  add column if not exists updated_by_name text;

alter table public.operators
  add column if not exists created_by_user_id text references public.app_users(user_id),
  add column if not exists created_by_name text,
  add column if not exists updated_by_user_id text references public.app_users(user_id),
  add column if not exists updated_by_name text;

alter table public.productions
  add column if not exists created_by_user_id text references public.app_users(user_id),
  add column if not exists created_by_name text,
  add column if not exists updated_by_user_id text references public.app_users(user_id),
  add column if not exists updated_by_name text;

alter table public.material_usage
  add column if not exists created_by_user_id text references public.app_users(user_id),
  add column if not exists created_by_name text,
  add column if not exists updated_by_user_id text references public.app_users(user_id),
  add column if not exists updated_by_name text;

-- HR/expense module tables
alter table public.salary_payments
  add column if not exists created_by_name text,
  add column if not exists updated_by_name text;

alter table public.operational_expenses
  add column if not exists created_by_name text,
  add column if not exists updated_by_name text;

alter table public.expense_advances
  add column if not exists created_by_name text,
  add column if not exists updated_by_name text;

-- User admin table itself
alter table public.app_users
  add column if not exists created_by_user_id text references public.app_users(user_id),
  add column if not exists created_by_name text,
  add column if not exists updated_by_user_id text references public.app_users(user_id),
  add column if not exists updated_by_name text;

-- Backfill display-name snapshots for existing expense tables where ids already exist.
update public.salary_payments s
set
  created_by_name = coalesce(
    s.created_by_name,
    (select u.display_name from public.app_users u where u.user_id = s.entered_by_user_id)
  ),
  updated_by_name = coalesce(
    s.updated_by_name,
    (select u.display_name from public.app_users u where u.user_id = s.last_edited_by_user_id)
  )
where s.entered_by_user_id is not null
   or s.last_edited_by_user_id is not null;

update public.operational_expenses s
set
  created_by_name = coalesce(
    s.created_by_name,
    (select u.display_name from public.app_users u where u.user_id = s.entered_by_user_id)
  ),
  updated_by_name = coalesce(
    s.updated_by_name,
    (select u.display_name from public.app_users u where u.user_id = s.last_edited_by_user_id)
  )
where s.entered_by_user_id is not null
   or s.last_edited_by_user_id is not null;

update public.expense_advances s
set
  created_by_name = coalesce(
    s.created_by_name,
    (select u.display_name from public.app_users u where u.user_id = s.entered_by_user_id)
  ),
  updated_by_name = coalesce(
    s.updated_by_name,
    (select u.display_name from public.app_users u where u.user_id = s.last_edited_by_user_id)
  )
where s.entered_by_user_id is not null
   or s.last_edited_by_user_id is not null;
