insert into public.app_enum_values (enum_id, enum_group, enum_value, enum_label, display_order, is_active)
values
  ('ENUM-CUSTOMER-TYPE-WHOLESALE-RETAIL-SHOPS','customer_type','Wholesale/Retail Shops','Wholesale/Retail Shops',10,true),
  ('ENUM-CUSTOMER-TYPE-WHOLESALE','customer_type','Wholesale','Wholesale',20,true),
  ('ENUM-CUSTOMER-TYPE-HOTELS-JUICE-STALLS-TEA-SHOPS','customer_type','Hotels / Juice Stalls / Tea Shops','Hotels / Juice Stalls / Tea Shops',30,true),
  ('ENUM-CUSTOMER-TYPE-HOSPITALS-COMPANIES-CATERINGS','customer_type','Hospitals / Companies / Caterings','Hospitals / Companies / Caterings',40,true)
on conflict (enum_group, enum_value) do update set
  enum_label = excluded.enum_label,
  display_order = excluded.display_order,
  is_active = excluded.is_active;
