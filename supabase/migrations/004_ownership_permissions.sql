-- Ownership-aware permissions for the custom app-user model.
-- The Vercel server should enforce these rules because this project is not
-- using Supabase Auth/RLS.

alter table public.app_user_module_access
  add column if not exists can_edit_own boolean not null default true;

alter table public.sales
  add column if not exists entered_by_user_id text references public.app_users(user_id),
  add column if not exists last_edited_by_user_id text references public.app_users(user_id);

alter table public.customer_payments
  add column if not exists entered_by_user_id text references public.app_users(user_id),
  add column if not exists last_edited_by_user_id text references public.app_users(user_id);

alter table public.leads
  add column if not exists entered_by_user_id text references public.app_users(user_id),
  add column if not exists last_edited_by_user_id text references public.app_users(user_id);

alter table public.contacts
  add column if not exists entered_by_user_id text references public.app_users(user_id),
  add column if not exists last_edited_by_user_id text references public.app_users(user_id);

alter table public.accounts
  add column if not exists entered_by_user_id text references public.app_users(user_id),
  add column if not exists last_edited_by_user_id text references public.app_users(user_id);

alter table public.products
  add column if not exists entered_by_user_id text references public.app_users(user_id),
  add column if not exists last_edited_by_user_id text references public.app_users(user_id);

alter table public.product_prices
  add column if not exists entered_by_user_id text references public.app_users(user_id),
  add column if not exists last_edited_by_user_id text references public.app_users(user_id);

alter table public.materials
  add column if not exists entered_by_user_id text references public.app_users(user_id),
  add column if not exists last_edited_by_user_id text references public.app_users(user_id);

alter table public.vendors
  add column if not exists entered_by_user_id text references public.app_users(user_id),
  add column if not exists last_edited_by_user_id text references public.app_users(user_id);

alter table public.material_types
  add column if not exists entered_by_user_id text references public.app_users(user_id),
  add column if not exists last_edited_by_user_id text references public.app_users(user_id);

alter table public.material_subtypes
  add column if not exists entered_by_user_id text references public.app_users(user_id),
  add column if not exists last_edited_by_user_id text references public.app_users(user_id);

alter table public.machines
  add column if not exists entered_by_user_id text references public.app_users(user_id),
  add column if not exists last_edited_by_user_id text references public.app_users(user_id);

alter table public.operators
  add column if not exists entered_by_user_id text references public.app_users(user_id),
  add column if not exists last_edited_by_user_id text references public.app_users(user_id);

alter table public.productions
  add column if not exists entered_by_user_id text references public.app_users(user_id),
  add column if not exists last_edited_by_user_id text references public.app_users(user_id);

alter table public.material_usage
  add column if not exists entered_by_user_id text references public.app_users(user_id),
  add column if not exists last_edited_by_user_id text references public.app_users(user_id);

alter table public.material_stock
  add column if not exists entered_by_user_id text references public.app_users(user_id),
  add column if not exists last_edited_by_user_id text references public.app_users(user_id);

alter table public.material_purchases
  add column if not exists entered_by_user_id text references public.app_users(user_id),
  add column if not exists last_edited_by_user_id text references public.app_users(user_id);

alter table public.vendor_payments
  add column if not exists entered_by_user_id text references public.app_users(user_id),
  add column if not exists last_edited_by_user_id text references public.app_users(user_id);

create index if not exists idx_sales_entered_by_user on public.sales(entered_by_user_id);
create index if not exists idx_customer_payments_entered_by_user on public.customer_payments(entered_by_user_id);
create index if not exists idx_leads_entered_by_user on public.leads(entered_by_user_id);
create index if not exists idx_contacts_entered_by_user on public.contacts(entered_by_user_id);
create index if not exists idx_accounts_entered_by_user on public.accounts(entered_by_user_id);
create index if not exists idx_products_entered_by_user on public.products(entered_by_user_id);
create index if not exists idx_product_prices_entered_by_user on public.product_prices(entered_by_user_id);
create index if not exists idx_materials_entered_by_user on public.materials(entered_by_user_id);
create index if not exists idx_vendors_entered_by_user on public.vendors(entered_by_user_id);
create index if not exists idx_machines_entered_by_user on public.machines(entered_by_user_id);
create index if not exists idx_operators_entered_by_user on public.operators(entered_by_user_id);
create index if not exists idx_productions_entered_by_user on public.productions(entered_by_user_id);
create index if not exists idx_material_usage_entered_by_user on public.material_usage(entered_by_user_id);
create index if not exists idx_material_stock_entered_by_user on public.material_stock(entered_by_user_id);
create index if not exists idx_material_purchases_entered_by_user on public.material_purchases(entered_by_user_id);
create index if not exists idx_vendor_payments_entered_by_user on public.vendor_payments(entered_by_user_id);
