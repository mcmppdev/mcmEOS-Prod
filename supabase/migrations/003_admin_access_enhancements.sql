-- Admin/resource enhancements plus custom app-user access control.
-- This intentionally does not depend on Supabase Auth.

alter table public.machines
  add column if not exists machine_type text,
  add column if not exists capacity_per_shift numeric(14, 3),
  add column if not exists location text,
  add column if not exists last_maintenance date,
  add column if not exists notes text;

alter table public.operators
  add column if not exists role text,
  add column if not exists shift text,
  add column if not exists contact text,
  add column if not exists join_date date,
  add column if not exists notes text;

create unique index if not exists idx_product_prices_one_active_per_packaging
  on public.product_prices(product_id, upper(packaging_type))
  where is_active;

create table if not exists public.material_stock (
  stock_id text primary key,
  material_id text references public.materials(material_id),
  material_name_snapshot text,
  material_type text,
  opening_stock numeric(14, 3) not null default 0,
  closing_stock numeric(14, 3) not null default 0,
  unit text,
  stock_date date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_material_stock_material on public.material_stock(material_id);
create index if not exists idx_material_stock_date on public.material_stock(stock_date);

drop trigger if exists set_material_stock_updated_at on public.material_stock;
create trigger set_material_stock_updated_at before update on public.material_stock
for each row execute function public.set_updated_at();

create table if not exists public.app_modules (
  module_key text primary key,
  module_name text not null,
  module_group text,
  route_path text,
  display_order integer not null default 0,
  is_active boolean not null default true
);

create table if not exists public.app_users (
  user_id text primary key,
  username text not null unique,
  display_name text not null,
  password_hash text not null,
  password_salt text,
  role text not null default 'user',
  is_active boolean not null default true,
  must_change_password boolean not null default false,
  last_login_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.app_user_module_access (
  user_id text not null references public.app_users(user_id) on delete cascade,
  module_key text not null references public.app_modules(module_key) on delete cascade,
  can_view boolean not null default true,
  can_create boolean not null default false,
  can_update boolean not null default false,
  can_delete boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, module_key)
);

create table if not exists public.app_login_audit (
  audit_id bigserial primary key,
  username text,
  user_id text references public.app_users(user_id),
  login_at timestamptz not null default now(),
  success boolean not null,
  ip_address text,
  user_agent text,
  failure_reason text
);

drop trigger if exists set_app_users_updated_at on public.app_users;
create trigger set_app_users_updated_at before update on public.app_users
for each row execute function public.set_updated_at();

drop trigger if exists set_app_user_module_access_updated_at on public.app_user_module_access;
create trigger set_app_user_module_access_updated_at before update on public.app_user_module_access
for each row execute function public.set_updated_at();

insert into public.app_modules (module_key, module_name, module_group, route_path, display_order)
values
  ('sales', 'Sales', 'CRM', '/sales', 10),
  ('payments', 'Customer Payments', 'CRM', '/payments', 20),
  ('customers', 'Customers', 'CRM', '/customers', 30),
  ('leads', 'Leads', 'CRM', '/leads', 40),
  ('dues', 'Customer Dues', 'CRM', '/dues', 50),
  ('reports_sales', 'Sales Reports', 'Reports', '/reports/sales', 60),
  ('products', 'Products and Pricing', 'Admin', '/admin/products', 70),
  ('materials_master', 'Material Master Data', 'Admin', '/admin/materials', 80),
  ('purchases', 'Material Purchases', 'Materials', '/purchases', 90),
  ('vendor_payments', 'Vendor Payments', 'Materials', '/vendor-payments', 100),
  ('production', 'Production Runs', 'Factory', '/production/runs', 110),
  ('material_usage', 'Material Usage', 'Factory', '/production/material-usage', 120),
  ('material_stock', 'Material Stock', 'Factory', '/materials/stock', 130),
  ('resources', 'Machines and Operators', 'Factory', '/resources', 140),
  ('users', 'Users and Access', 'Admin', '/admin/users', 150)
on conflict (module_key) do update set
  module_name = excluded.module_name,
  module_group = excluded.module_group,
  route_path = excluded.route_path,
  display_order = excluded.display_order,
  is_active = excluded.is_active;

create or replace view public.vendor_balances as
with purchase_totals as (
  select
    vendor_id,
    max(vendor_name_snapshot) as vendor_name,
    sum(coalesce(total_amount, 0)) as total_purchases
  from public.material_purchases
  group by vendor_id
),
payment_totals as (
  select
    vendor_id,
    max(vendor_name_snapshot) as vendor_name,
    sum(coalesce(amount, 0)) as total_paid
  from public.vendor_payments
  group by vendor_id
)
select
  coalesce(p.vendor_id, pay.vendor_id) as vendor_id,
  coalesce(p.vendor_name, pay.vendor_name) as vendor_name,
  coalesce(p.total_purchases, 0) as total_purchases,
  coalesce(pay.total_paid, 0) as total_paid,
  coalesce(p.total_purchases, 0) - coalesce(pay.total_paid, 0) as balance
from purchase_totals p
full outer join payment_totals pay on pay.vendor_id = p.vendor_id;

create or replace view public.production_daily_summary as
select
  production_date,
  product_id,
  product_name_snapshot,
  machine_id,
  machine_name_snapshot,
  operator_id,
  operator_name_snapshot,
  shift,
  status,
  count(*) as run_count,
  sum(coalesce(packets_qty, 0)) as packets_qty,
  sum(coalesce(box_qty, 0)) as box_qty,
  sum(coalesce(total_cups, 0)) as total_cups
from public.productions
group by
  production_date,
  product_id,
  product_name_snapshot,
  machine_id,
  machine_name_snapshot,
  operator_id,
  operator_name_snapshot,
  shift,
  status;

create or replace view public.material_usage_summary as
select
  usage_date,
  material_id,
  material_name_snapshot,
  material_type,
  unit,
  machine_id,
  machine_name_snapshot,
  operator_id,
  operator_name_snapshot,
  shift,
  count(*) as usage_count,
  sum(coalesce(qty_used, 0)) as qty_used
from public.material_usage
group by
  usage_date,
  material_id,
  material_name_snapshot,
  material_type,
  unit,
  machine_id,
  machine_name_snapshot,
  operator_id,
  operator_name_snapshot,
  shift;
