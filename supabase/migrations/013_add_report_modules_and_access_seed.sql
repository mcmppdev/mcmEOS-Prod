-- Add report modules so admin can control visibility per user.
-- Also grants these report modules to existing super admins by default.

insert into public.app_modules (module_key, module_name, module_group, route_path, display_order, is_active)
values
  ('reports_operations', 'Operations Reports', 'Reports', '/reports/operations', 61, true),
  ('reports_production', 'Production Reports', 'Reports', '/reports/production', 62, true),
  ('reports_procurement', 'Procurement Reports', 'Reports', '/reports/procurement', 63, true)
on conflict (module_key) do update set
  module_name = excluded.module_name,
  module_group = excluded.module_group,
  route_path = excluded.route_path,
  display_order = excluded.display_order,
  is_active = excluded.is_active;

insert into public.app_user_module_access (
  user_id,
  module_key,
  can_view,
  can_create,
  can_update,
  can_delete,
  can_edit_own
)
select
  u.user_id,
  m.module_key,
  true,
  true,
  true,
  true,
  true
from public.app_users u
cross join (
  values ('reports_operations'), ('reports_production'), ('reports_procurement')
) as m(module_key)
where lower(coalesce(u.role, '')) = 'super_admin'
on conflict (user_id, module_key) do nothing;
