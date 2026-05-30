-- Fail closed for environment-scoped defaults.
-- Application inserts should pass source_env explicitly via envTag().
-- Existing rows are not modified by this migration.

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
    'material_usage',
    'machine_maintenance',
    'leadership_report_usage'
  ];
begin
  foreach tbl in array tables loop
    execute format(
      'alter table if exists public.%I alter column source_env set default current_setting(''app.source_env'')',
      tbl
    );
  end loop;
end $$;
