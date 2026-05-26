-- Backfill restored sales line-item fields from legacy public.sales
-- for rows that were already migrated via source_sale_id.

update public.sales_line_items li
set
  source_product_id = coalesce(li.source_product_id, s.source_product_id),
  package_qty = coalesce(li.package_qty, s.package_qty, 0),
  list_sale_packet_price = coalesce(li.list_sale_packet_price, s.list_sale_packet_price, 0),
  updated_list_sale_packet_price = coalesce(li.updated_list_sale_packet_price, s.updated_list_sale_packet_price, 0),
  sale_price_per_cup = coalesce(li.sale_price_per_cup, s.sale_price_per_cup, 0)
from public.sales s
where li.source_sale_id is not null
  and s.sale_id = li.source_sale_id;
