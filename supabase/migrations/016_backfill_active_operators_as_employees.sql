-- Ensure every active resource operator also exists as an employee record.

insert into public.employees (
  employee_id,
  employee_name,
  role,
  department,
  operator_id,
  contact,
  join_date,
  status,
  notes
)
select
  'EMP-' || lpad(regexp_replace(o.operator_id, '\D', '', 'g'), 3, '0') as employee_id,
  o.operator_name,
  nullif(o.role, ''),
  'Factory',
  o.operator_id,
  nullif(o.contact, ''),
  o.join_date,
  'Active',
  o.notes
from public.operators o
where o.operator_id is not null
  and o.operator_name is not null
  and lower(coalesce(o.status, 'Active')) = 'active'
  and not exists (
    select 1
    from public.employees e
    where e.operator_id = o.operator_id
  )
on conflict (employee_id) do update set
  employee_name = excluded.employee_name,
  role = excluded.role,
  department = excluded.department,
  operator_id = excluded.operator_id,
  contact = excluded.contact,
  join_date = excluded.join_date,
  status = 'Active',
  notes = excluded.notes;

update public.operators o
set employee_id = e.employee_id
from public.employees e
where e.operator_id = o.operator_id
  and lower(coalesce(o.status, 'Active')) = 'active'
  and coalesce(o.employee_id, '') <> e.employee_id;

update public.employees e
set status = 'Inactive'
from public.operators o
where e.operator_id = o.operator_id
  and lower(coalesce(o.status, '')) <> 'active'
  and e.status = 'Active';
