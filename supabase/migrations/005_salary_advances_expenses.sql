-- Salary, advances, and expenses module.

create table if not exists public.salary_payments (
  salary_payment_id text primary key,
  submitted_time timestamptz,
  payment_date date not null,
  paid_to text,
  payment_type text,
  amount numeric(14, 2) not null default 0,
  payment_method text,
  comments text,
  entered_by_user_id text references public.app_users(user_id),
  last_edited_by_user_id text references public.app_users(user_id),
  source_file text,
  source_row_number integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.operational_expenses (
  expense_id text primary key,
  submitted_time timestamptz,
  expense_date date not null,
  expense_type text,
  paid_to text,
  amount numeric(14, 2) not null default 0,
  comments text,
  entered_by_user_id text references public.app_users(user_id),
  last_edited_by_user_id text references public.app_users(user_id),
  source_file text,
  source_row_number integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.expense_advances (
  expense_advance_id text primary key,
  submitted_time timestamptz,
  payment_date date not null,
  paid_to text,
  amount numeric(14, 2) not null default 0,
  entered_by_user_id text references public.app_users(user_id),
  last_edited_by_user_id text references public.app_users(user_id),
  source_file text,
  source_row_number integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_salary_payments_date on public.salary_payments(payment_date);
create index if not exists idx_salary_payments_paid_to on public.salary_payments(paid_to);
create index if not exists idx_operational_expenses_date on public.operational_expenses(expense_date);
create index if not exists idx_operational_expenses_type on public.operational_expenses(expense_type);
create index if not exists idx_expense_advances_date on public.expense_advances(payment_date);
create index if not exists idx_expense_advances_paid_to on public.expense_advances(paid_to);

drop trigger if exists set_salary_payments_updated_at on public.salary_payments;
create trigger set_salary_payments_updated_at before update on public.salary_payments
for each row execute function public.set_updated_at();

drop trigger if exists set_operational_expenses_updated_at on public.operational_expenses;
create trigger set_operational_expenses_updated_at before update on public.operational_expenses
for each row execute function public.set_updated_at();

drop trigger if exists set_expense_advances_updated_at on public.expense_advances;
create trigger set_expense_advances_updated_at before update on public.expense_advances
for each row execute function public.set_updated_at();

insert into public.app_modules (module_key, module_name, module_group, route_path, display_order)
values
  ('salary_payments', 'Salary Payments', 'HR', '/hr/salary-payments', 160),
  ('operational_expenses', 'Operational Expenses', 'HR', '/hr/expenses', 170),
  ('expense_advances', 'Expense Advances', 'HR', '/hr/expense-advances', 180)
on conflict (module_key) do update set
  module_name = excluded.module_name,
  module_group = excluded.module_group,
  route_path = excluded.route_path,
  display_order = excluded.display_order,
  is_active = excluded.is_active;
