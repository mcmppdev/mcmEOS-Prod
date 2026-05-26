-- Restore legacy sales calculation fields into new line-item model.

alter table public.sales_line_items
  add column if not exists package_qty integer,
  add column if not exists list_sale_packet_price numeric(12, 4),
  add column if not exists updated_list_sale_packet_price numeric(12, 4),
  add column if not exists sale_price_per_cup numeric(12, 4),
  add column if not exists source_product_id text;
