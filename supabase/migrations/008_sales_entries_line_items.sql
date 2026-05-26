-- Sales header + line-items model for multi-line sales entry.

create table if not exists public.sales_entries (
  sale_entry_id text primary key,
  sale_date date not null,
  cid text references public.contacts(cid),
  aid text references public.accounts(aid),
  customer_name_snapshot text,
  company_name_snapshot text,
  customer_mobile_snapshot text,
  status text,
  note text,
  total_amount numeric(14, 2) not null default 0,
  created_by_user_id text references public.app_users(user_id),
  created_by_name text,
  updated_by_user_id text references public.app_users(user_id),
  updated_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.sales_line_items (
  sale_line_id text primary key,
  sale_entry_id text not null references public.sales_entries(sale_entry_id) on delete cascade,
  product_id text references public.products(product_id),
  price_id text references public.product_prices(price_id),
  packaging_type text,
  product_name_snapshot text,
  unit_price numeric(12, 4) not null default 0,
  packets_quantity numeric(12, 3) not null default 0,
  box_quantity numeric(12, 3) not null default 0,
  total_amount numeric(14, 2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_sales_entries_date on public.sales_entries(sale_date);
create index if not exists idx_sales_entries_cid on public.sales_entries(cid);
create index if not exists idx_sales_line_items_entry on public.sales_line_items(sale_entry_id);

drop trigger if exists set_sales_entries_updated_at on public.sales_entries;
create trigger set_sales_entries_updated_at before update on public.sales_entries
for each row execute function public.set_updated_at();

drop trigger if exists set_sales_line_items_updated_at on public.sales_line_items;
create trigger set_sales_line_items_updated_at before update on public.sales_line_items
for each row execute function public.set_updated_at();
