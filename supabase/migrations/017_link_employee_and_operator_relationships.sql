alter table if exists public.operational_expenses
  add column if not exists employee_id text references public.employees(employee_id);

alter table if exists public.expense_advances
  add column if not exists employee_id text references public.employees(employee_id);

with unique_employees as (
  select lower(trim(employee_name)) as employee_name_key, min(employee_id) as employee_id
  from public.employees
  where employee_name is not null and trim(employee_name) <> ''
  group by lower(trim(employee_name))
  having count(*) = 1
)
update public.salary_payments sp
set employee_id = ue.employee_id
from unique_employees ue
where sp.employee_id is null
  and sp.paid_to is not null
  and lower(trim(sp.paid_to)) = ue.employee_name_key;

with unique_employees as (
  select lower(trim(employee_name)) as employee_name_key, min(employee_id) as employee_id
  from public.employees
  where employee_name is not null and trim(employee_name) <> ''
  group by lower(trim(employee_name))
  having count(*) = 1
)
update public.operational_expenses oe
set employee_id = ue.employee_id
from unique_employees ue
where oe.employee_id is null
  and oe.paid_to is not null
  and lower(trim(oe.paid_to)) = ue.employee_name_key;

with unique_employees as (
  select lower(trim(employee_name)) as employee_name_key, min(employee_id) as employee_id
  from public.employees
  where employee_name is not null and trim(employee_name) <> ''
  group by lower(trim(employee_name))
  having count(*) = 1
)
update public.expense_advances ea
set employee_id = ue.employee_id
from unique_employees ue
where ea.employee_id is null
  and ea.paid_to is not null
  and lower(trim(ea.paid_to)) = ue.employee_name_key;

update public.productions p
set operator_id = o.operator_id
from public.operators o
where p.operator_id is null
  and p.operator_name_snapshot is not null
  and lower(trim(p.operator_name_snapshot)) = lower(trim(o.operator_name));

update public.productions p
set machine_id = m.machine_id
from public.machines m
where p.machine_id is null
  and p.machine_name_snapshot is not null
  and lower(trim(p.machine_name_snapshot)) = lower(trim(m.machine_name));

update public.material_usage mu
set operator_id = o.operator_id
from public.operators o
where mu.operator_id is null
  and mu.operator_name_snapshot is not null
  and lower(trim(mu.operator_name_snapshot)) = lower(trim(o.operator_name));

update public.material_usage mu
set machine_id = m.machine_id
from public.machines m
where mu.machine_id is null
  and mu.machine_name_snapshot is not null
  and lower(trim(mu.machine_name_snapshot)) = lower(trim(m.machine_name));
