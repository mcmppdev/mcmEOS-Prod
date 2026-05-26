-- Initial Supabase schema for MCM migration.
-- Designed for CSV imports from Google Sheets with historical IDs preserved.

create table if not exists public.contacts (
  cid text primary key,
  name text,
  company text,
  customer_type text,
  mobile text,
  city text,
  state text,
  contact_status text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.accounts (
  aid text primary key,
  cid text references public.contacts(cid),
  contact_name text,
  company text,
  account_status text,
  mobile text,
  city text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.contacts
  add column if not exists aid text;

create table if not exists public.leads (
  lid text primary key,
  name text,
  company text,
  customer_type text,
  mobile text,
  city text,
  state text,
  lead_status text,
  source text,
  assigned_to text,
  follow_up_date date,
  notes text,
  created_date date,
  last_updated date,
  converted_cid text references public.contacts(cid),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.products (
  product_id text primary key,
  name text not null,
  category text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.product_prices (
  price_id text primary key,
  product_id text not null references public.products(product_id),
  packaging_type text not null,
  unit_price numeric(12, 4) not null,
  effective_from date,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.sales (
  sale_id text primary key,
  sale_date date,
  cid text references public.contacts(cid),
  aid text references public.accounts(aid),
  customer_name_snapshot text,
  company_name_snapshot text,
  customer_mobile_snapshot text,
  note text,
  source_product_id text,
  product_id text references public.products(product_id),
  price_id text references public.product_prices(price_id),
  packaging_type text,
  product_name_snapshot text,
  unit_price numeric(12, 4),
  cups_in_packet integer,
  list_sale_packet_price numeric(12, 4),
  updated_list_sale_packet_price numeric(12, 4),
  packets_quantity numeric(12, 3),
  box_quantity numeric(12, 3),
  sale_price_per_cup numeric(12, 4),
  total_amount numeric(14, 2),
  date_time_entered timestamptz,
  status text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.customer_payments (
  payment_id bigserial primary key,
  cid text references public.contacts(cid),
  aid text references public.accounts(aid),
  customer_name_snapshot text,
  company_name_snapshot text,
  customer_mobile_snapshot text,
  amount_paid numeric(14, 2) not null,
  payment_mode text,
  payment_date date,
  source_date text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.material_types (
  type_id text primary key,
  type_name text not null
);

create table if not exists public.material_subtypes (
  subtype_id text primary key,
  subtype_name text not null
);

create table if not exists public.materials (
  material_id text primary key,
  material_name text not null,
  material_type text,
  type_id text references public.material_types(type_id),
  notes text,
  tenant_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.vendors (
  vendor_id text primary key,
  vendor_name text not null,
  contact text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.machines (
  machine_id text primary key,
  machine_name text not null unique,
  status text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.operators (
  operator_id text primary key,
  operator_name text not null unique,
  status text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.productions (
  prod_id text primary key,
  production_date date,
  product_name_snapshot text,
  product_id text references public.products(product_id),
  cups_per_packet integer,
  packets_qty numeric(12, 3),
  box_qty numeric(12, 3),
  total_cups numeric(14, 3),
  operator_name_snapshot text,
  operator_id text references public.operators(operator_id),
  machine_name_snapshot text,
  machine_id text references public.machines(machine_id),
  shift text,
  status text,
  notes text,
  date_entered timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.material_usage (
  usage_id text primary key,
  prod_id text,
  production_id text references public.productions(prod_id),
  usage_date date,
  material_name_snapshot text,
  material_id text references public.materials(material_id),
  material_type text,
  qty_used numeric(14, 3),
  unit text,
  operator_name_snapshot text,
  operator_id text references public.operators(operator_id),
  machine_name_snapshot text,
  machine_id text references public.machines(machine_id),
  shift text,
  notes text,
  date_entered timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.material_purchases (
  purchase_id text primary key,
  trip_id text,
  purchase_date date,
  vendor_id text references public.vendors(vendor_id),
  vendor_name_snapshot text,
  material_id text references public.materials(material_id),
  material_name_snapshot text,
  material_type text,
  type_id text references public.material_types(type_id),
  material_subtype text,
  subtype_id text references public.material_subtypes(subtype_id),
  total_qty numeric(14, 3),
  total_kg numeric(14, 3),
  blanks_per_kg numeric(14, 3),
  cost_per_kg numeric(14, 4),
  total_amount numeric(14, 2),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.vendor_payments (
  payment_id text primary key,
  payment_date date,
  vendor_id text references public.vendors(vendor_id),
  vendor_name_snapshot text,
  amount numeric(14, 2),
  payment_method text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_sales_cid on public.sales(cid);
create index if not exists idx_sales_aid on public.sales(aid);
create index if not exists idx_sales_date on public.sales(sale_date);
create index if not exists idx_customer_payments_cid on public.customer_payments(cid);
create index if not exists idx_customer_payments_date on public.customer_payments(payment_date);
create index if not exists idx_productions_date on public.productions(production_date);
create index if not exists idx_material_usage_date on public.material_usage(usage_date);
create index if not exists idx_material_purchases_vendor on public.material_purchases(vendor_id);
create index if not exists idx_vendor_payments_vendor on public.vendor_payments(vendor_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_contacts_updated_at on public.contacts;
create trigger set_contacts_updated_at before update on public.contacts
for each row execute function public.set_updated_at();

drop trigger if exists set_accounts_updated_at on public.accounts;
create trigger set_accounts_updated_at before update on public.accounts
for each row execute function public.set_updated_at();

drop trigger if exists set_leads_updated_at on public.leads;
create trigger set_leads_updated_at before update on public.leads
for each row execute function public.set_updated_at();

drop trigger if exists set_products_updated_at on public.products;
create trigger set_products_updated_at before update on public.products
for each row execute function public.set_updated_at();

drop trigger if exists set_product_prices_updated_at on public.product_prices;
create trigger set_product_prices_updated_at before update on public.product_prices
for each row execute function public.set_updated_at();

drop trigger if exists set_sales_updated_at on public.sales;
create trigger set_sales_updated_at before update on public.sales
for each row execute function public.set_updated_at();

drop trigger if exists set_customer_payments_updated_at on public.customer_payments;
create trigger set_customer_payments_updated_at before update on public.customer_payments
for each row execute function public.set_updated_at();

drop trigger if exists set_materials_updated_at on public.materials;
create trigger set_materials_updated_at before update on public.materials
for each row execute function public.set_updated_at();

drop trigger if exists set_vendors_updated_at on public.vendors;
create trigger set_vendors_updated_at before update on public.vendors
for each row execute function public.set_updated_at();

drop trigger if exists set_machines_updated_at on public.machines;
create trigger set_machines_updated_at before update on public.machines
for each row execute function public.set_updated_at();

drop trigger if exists set_operators_updated_at on public.operators;
create trigger set_operators_updated_at before update on public.operators
for each row execute function public.set_updated_at();

drop trigger if exists set_productions_updated_at on public.productions;
create trigger set_productions_updated_at before update on public.productions
for each row execute function public.set_updated_at();

drop trigger if exists set_material_usage_updated_at on public.material_usage;
create trigger set_material_usage_updated_at before update on public.material_usage
for each row execute function public.set_updated_at();

drop trigger if exists set_material_purchases_updated_at on public.material_purchases;
create trigger set_material_purchases_updated_at before update on public.material_purchases
for each row execute function public.set_updated_at();

drop trigger if exists set_vendor_payments_updated_at on public.vendor_payments;
create trigger set_vendor_payments_updated_at before update on public.vendor_payments
for each row execute function public.set_updated_at();
