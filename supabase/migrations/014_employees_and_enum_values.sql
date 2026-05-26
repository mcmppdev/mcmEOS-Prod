-- Employee master and admin-managed dropdown values.

create table if not exists public.employees (
  employee_id text primary key,
  employee_name text not null,
  role text,
  department text,
  operator_id text references public.operators(operator_id),
  contact text,
  join_date date,
  status text not null default 'Active',
  salary_rate numeric(14, 2),
  notes text,
  entered_by_user_id text references public.app_users(user_id),
  last_edited_by_user_id text references public.app_users(user_id),
  created_by_name text,
  updated_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.operators
  add column if not exists employee_id text references public.employees(employee_id);

alter table public.salary_payments
  add column if not exists employee_id text references public.employees(employee_id);

create index if not exists idx_employees_status on public.employees(status);
create index if not exists idx_employees_operator on public.employees(operator_id);
create index if not exists idx_salary_payments_employee on public.salary_payments(employee_id);

drop trigger if exists set_employees_updated_at on public.employees;
create trigger set_employees_updated_at before update on public.employees
for each row execute function public.set_updated_at();

insert into public.employees (
  employee_id, employee_name, role, department, operator_id, contact, join_date, status, notes
)
select
  'EMP-' || lpad(regexp_replace(operator_id, '\D', '', 'g'), 3, '0'),
  operator_name,
  nullif(role, ''),
  'Factory',
  operator_id,
  nullif(contact, ''),
  join_date,
  coalesce(nullif(status, ''), 'Active'),
  notes
from public.operators
where operator_id is not null
  and operator_name is not null
  and lower(coalesce(status, 'Active')) = 'active'
on conflict (employee_id) do nothing;

update public.operators o
set employee_id = e.employee_id
from public.employees e
where e.operator_id = o.operator_id
  and o.employee_id is null;

create table if not exists public.app_enum_values (
  enum_id text primary key,
  enum_group text not null,
  enum_value text not null,
  enum_label text not null,
  display_order integer not null default 100,
  is_active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(enum_group, enum_value)
);

create index if not exists idx_app_enum_values_group on public.app_enum_values(enum_group, display_order);

drop trigger if exists set_app_enum_values_updated_at on public.app_enum_values;
create trigger set_app_enum_values_updated_at before update on public.app_enum_values
for each row execute function public.set_updated_at();

insert into public.app_enum_values (enum_id, enum_group, enum_value, enum_label, display_order)
values
  ('ENUM-PAYTYPE-SALARY', 'salary_payment_type', 'Salary', 'Salary', 10),
  ('ENUM-PAYTYPE-ADVANCE', 'salary_payment_type', 'Advance', 'Advance', 20),
  ('ENUM-PAYTYPE-BONUS', 'salary_payment_type', 'Bonus', 'Bonus', 30),
  ('ENUM-PAYTYPE-OTHER', 'salary_payment_type', 'Other', 'Other', 90),
  ('ENUM-PAYMETHOD-CASH', 'payment_method', 'Cash', 'Cash', 10),
  ('ENUM-PAYMETHOD-TRANSFER', 'payment_method', 'Transfer', 'Transfer', 20),
  ('ENUM-PAYMETHOD-UPI', 'payment_method', 'UPI', 'UPI', 30),
  ('ENUM-PAYMETHOD-CHEQUE', 'payment_method', 'Cheque', 'Cheque', 40),
  ('ENUM-EXPTYPE-FUEL', 'expense_type', 'Fuel', 'Fuel', 10),
  ('ENUM-EXPTYPE-RENT', 'expense_type', 'Rent', 'Rent', 20),
  ('ENUM-EXPTYPE-UTILITIES', 'expense_type', 'Utilities', 'Utilities', 30),
  ('ENUM-EXPTYPE-MAINTENANCE', 'expense_type', 'Maintenance', 'Maintenance', 40),
  ('ENUM-EXPTYPE-OFFICE', 'expense_type', 'Office', 'Office', 50),
  ('ENUM-EXPTYPE-TRAVEL', 'expense_type', 'Travel', 'Travel', 60),
  ('ENUM-EXPTYPE-OTHER', 'expense_type', 'Other', 'Other', 90),
  ('ENUM-EMPSTATUS-ACTIVE', 'employee_status', 'Active', 'Active', 10),
  ('ENUM-EMPSTATUS-INACTIVE', 'employee_status', 'Inactive', 'Inactive', 90),
  ('ENUM-EMPDEPT-FACTORY', 'employee_department', 'Factory', 'Factory', 10),
  ('ENUM-EMPDEPT-ADMIN', 'employee_department', 'Admin', 'Admin', 20),
  ('ENUM-EMPDEPT-SALES', 'employee_department', 'Sales', 'Sales', 30),
  ('ENUM-EMPDEPT-FINANCE', 'employee_department', 'Finance', 'Finance', 40),
  ('ENUM-SHIFT-MORNING', 'shift', 'Morning', 'Morning', 10),
  ('ENUM-SHIFT-EVENING', 'shift', 'Evening', 'Evening', 20),
  ('ENUM-SHIFT-NIGHT', 'shift', 'Night', 'Night', 30)
on conflict (enum_group, enum_value) do update set
  enum_label = excluded.enum_label,
  display_order = excluded.display_order,
  is_active = true;

insert into public.app_modules (module_key, module_name, module_group, route_path, display_order)
values
  ('employees', 'Employees', 'HR', '/hr/employees', 155),
  ('enum_values', 'Dropdown Values', 'Admin', '/admin/enums', 195)
on conflict (module_key) do update set
  module_name = excluded.module_name,
  module_group = excluded.module_group,
  route_path = excluded.route_path,
  display_order = excluded.display_order,
  is_active = true;
