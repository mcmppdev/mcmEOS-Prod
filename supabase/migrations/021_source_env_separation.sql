-- Separate Dev and Prod transactional records while sharing master/reference data.
-- Existing rows are treated as production by default.

do $$
declare
  tbl text;
  tables text[] := array[
    'contacts',
    'accounts',
    'leads',
    'sales',
    'sales_entries',
    'sales_line_items',
    'customer_payments',
    'tasks',
    'salary_payments',
    'operational_expenses',
    'expense_advances',
    'material_purchases',
    'vendor_payments',
    'productions',
    'material_usage'
  ];
begin
  foreach tbl in array tables loop
    execute format('alter table if exists public.%I add column if not exists source_env text', tbl);
    execute format('update public.%I set source_env = ''prod'' where source_env is null', tbl);
    execute format(
      'alter table if exists public.%I alter column source_env set default coalesce(nullif(current_setting(''app.source_env'', true), ''''), ''prod'')',
      tbl
    );
    execute format('alter table if exists public.%I alter column source_env set not null', tbl);
    execute format('alter table if exists public.%I drop constraint if exists %I', tbl, tbl || '_source_env_check');
    execute format(
      'alter table if exists public.%I add constraint %I check (source_env in (''dev'', ''prod''))',
      tbl,
      tbl || '_source_env_check'
    );
    execute format('create index if not exists %I on public.%I (source_env)', tbl || '_source_env_idx', tbl);
  end loop;
end $$;

create index if not exists contacts_source_env_created_at_idx on public.contacts (source_env, created_at);
create index if not exists accounts_source_env_created_at_idx on public.accounts (source_env, created_at);
create index if not exists leads_source_env_follow_up_date_idx on public.leads (source_env, follow_up_date);
create index if not exists sales_source_env_sale_date_idx on public.sales (source_env, sale_date);
create index if not exists sales_entries_source_env_sale_date_idx on public.sales_entries (source_env, sale_date);
create index if not exists sales_line_items_source_env_sale_entry_idx on public.sales_line_items (source_env, sale_entry_id);
create index if not exists customer_payments_source_env_payment_date_idx on public.customer_payments (source_env, payment_date);
create index if not exists tasks_source_env_due_date_idx on public.tasks (source_env, due_date);
create index if not exists salary_payments_source_env_payment_date_idx on public.salary_payments (source_env, payment_date);
create index if not exists operational_expenses_source_env_expense_date_idx on public.operational_expenses (source_env, expense_date);
create index if not exists expense_advances_source_env_payment_date_idx on public.expense_advances (source_env, payment_date);
create index if not exists material_purchases_source_env_purchase_date_idx on public.material_purchases (source_env, purchase_date);
create index if not exists vendor_payments_source_env_payment_date_idx on public.vendor_payments (source_env, payment_date);
create index if not exists productions_source_env_production_date_idx on public.productions (source_env, production_date);
create index if not exists material_usage_source_env_usage_date_idx on public.material_usage (source_env, usage_date);
