insert into public.app_enum_values (enum_id, enum_group, enum_value, enum_label, display_order)
values
  ('ENUM-EXPTYPE-FUEL', 'expense_type', 'Fuel', 'Fuel', 10),
  ('ENUM-EXPTYPE-RENT', 'expense_type', 'Rent', 'Rent', 20),
  ('ENUM-EXPTYPE-UTILITIES', 'expense_type', 'Utilities', 'Utilities', 30),
  ('ENUM-EXPTYPE-MAINTENANCE', 'expense_type', 'Maintenance', 'Maintenance', 40),
  ('ENUM-EXPTYPE-OFFICE', 'expense_type', 'Office', 'Office', 50),
  ('ENUM-EXPTYPE-TRAVEL', 'expense_type', 'Travel', 'Travel', 60),
  ('ENUM-EXPTYPE-OTHER', 'expense_type', 'Other', 'Other', 90)
on conflict (enum_group, enum_value) do update set
  enum_label = excluded.enum_label,
  display_order = excluded.display_order,
  is_active = true;
