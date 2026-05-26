-- Rename legacy/new sales quantity-per-packet column to package_qty.

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'sales'
      and column_name = 'cups_in_packet'
  ) then
    alter table public.sales rename column cups_in_packet to package_qty;
  end if;
end $$;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'sales_line_items'
      and column_name = 'cups_in_packet'
  ) then
    alter table public.sales_line_items rename column cups_in_packet to package_qty;
  end if;
end $$;
