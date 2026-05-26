-- Backfill legacy public.sales rows into new sales header/line tables.
-- Rule: one sales entry per customer per day, with multiple legacy rows as line items.

-- Keep legacy source id for idempotent migration runs.
alter table public.sales_line_items
  add column if not exists source_sale_id text;

create unique index if not exists uq_sales_line_items_source_sale_id
  on public.sales_line_items(source_sale_id)
  where source_sale_id is not null;

with legacy as (
  select
    s.sale_id,
    coalesce(s.sale_date, (s.date_time_entered at time zone 'utc')::date, current_date) as grp_sale_date,
    s.cid,
    s.aid,
    s.customer_name_snapshot,
    s.company_name_snapshot,
    s.customer_mobile_snapshot,
    coalesce(s.status, 'Completed') as status,
    s.note,
    s.product_id,
    s.source_product_id,
    s.price_id,
    s.packaging_type,
    s.product_name_snapshot,
    coalesce(s.unit_price, 0) as unit_price,
    coalesce(s.package_qty, 0) as package_qty,
    coalesce(s.list_sale_packet_price, 0) as list_sale_packet_price,
    coalesce(s.updated_list_sale_packet_price, 0) as updated_list_sale_packet_price,
    coalesce(s.sale_price_per_cup, 0) as sale_price_per_cup,
    coalesce(s.packets_quantity, 0) as packets_quantity,
    coalesce(s.box_quantity, 0) as box_quantity,
    coalesce(
      s.total_amount,
      coalesce(s.unit_price, 0) * (coalesce(s.packets_quantity, 0) + coalesce(s.box_quantity, 0))
    ) as line_total_amount,
    s.created_at,
    s.updated_at
  from public.sales s
),
grouped as (
  select
    'SE-MIG-' || substr(md5(concat_ws('|',
      l.grp_sale_date::text,
      coalesce(l.cid, ''),
      coalesce(l.customer_name_snapshot, ''),
      coalesce(l.company_name_snapshot, ''),
      coalesce(l.customer_mobile_snapshot, '')
    )), 1, 16) as sale_entry_id,
    l.grp_sale_date as sale_date,
    l.cid,
    l.aid,
    l.customer_name_snapshot,
    l.company_name_snapshot,
    l.customer_mobile_snapshot,
    max(l.status) as status,
    string_agg(distinct nullif(trim(l.note), ''), ' | ') as note,
    sum(l.line_total_amount)::numeric(14,2) as total_amount,
    min(l.created_at) as created_at,
    max(l.updated_at) as updated_at
  from legacy l
  group by
    l.grp_sale_date,
    l.cid,
    l.aid,
    l.customer_name_snapshot,
    l.company_name_snapshot,
    l.customer_mobile_snapshot
)
insert into public.sales_entries (
  sale_entry_id,
  sale_date,
  cid,
  aid,
  customer_name_snapshot,
  company_name_snapshot,
  customer_mobile_snapshot,
  status,
  note,
  total_amount,
  created_by_name,
  updated_by_name,
  created_at,
  updated_at
)
select
  g.sale_entry_id,
  g.sale_date,
  g.cid,
  g.aid,
  g.customer_name_snapshot,
  g.company_name_snapshot,
  g.customer_mobile_snapshot,
  g.status,
  g.note,
  g.total_amount,
  'Legacy Migration',
  'Legacy Migration',
  g.created_at,
  g.updated_at
from grouped g
on conflict (sale_entry_id) do update set
  total_amount = excluded.total_amount,
  updated_by_name = excluded.updated_by_name,
  updated_at = greatest(public.sales_entries.updated_at, excluded.updated_at);

with legacy as (
  select
    s.sale_id,
    coalesce(s.sale_date, (s.date_time_entered at time zone 'utc')::date, current_date) as grp_sale_date,
    s.cid,
    s.customer_name_snapshot,
    s.company_name_snapshot,
    s.customer_mobile_snapshot,
    s.product_id,
    s.source_product_id,
    s.price_id,
    s.packaging_type,
    s.product_name_snapshot,
    coalesce(s.unit_price, 0) as unit_price,
    coalesce(s.package_qty, 0) as package_qty,
    coalesce(s.list_sale_packet_price, 0) as list_sale_packet_price,
    coalesce(s.updated_list_sale_packet_price, 0) as updated_list_sale_packet_price,
    coalesce(s.sale_price_per_cup, 0) as sale_price_per_cup,
    coalesce(s.packets_quantity, 0) as packets_quantity,
    coalesce(s.box_quantity, 0) as box_quantity,
    coalesce(
      s.total_amount,
      coalesce(s.unit_price, 0) * (coalesce(s.packets_quantity, 0) + coalesce(s.box_quantity, 0))
    ) as line_total_amount,
    s.created_at,
    s.updated_at
  from public.sales s
),
mapped as (
  select
    l.*,
    'SE-MIG-' || substr(md5(concat_ws('|',
      l.grp_sale_date::text,
      coalesce(l.cid, ''),
      coalesce(l.customer_name_snapshot, ''),
      coalesce(l.company_name_snapshot, ''),
      coalesce(l.customer_mobile_snapshot, '')
    )), 1, 16) as sale_entry_id
  from legacy l
)
insert into public.sales_line_items (
  sale_line_id,
  sale_entry_id,
  source_sale_id,
  source_product_id,
  product_id,
  price_id,
  packaging_type,
  product_name_snapshot,
  unit_price,
  package_qty,
  list_sale_packet_price,
  updated_list_sale_packet_price,
  sale_price_per_cup,
  packets_quantity,
  box_quantity,
  total_amount,
  created_at,
  updated_at
)
select
  'SL-MIG-' || substr(md5(coalesce(m.sale_id, random()::text)), 1, 16) as sale_line_id,
  m.sale_entry_id,
  m.sale_id,
  m.source_product_id,
  m.product_id,
  m.price_id,
  m.packaging_type,
  m.product_name_snapshot,
  m.unit_price,
  m.package_qty,
  m.list_sale_packet_price,
  m.updated_list_sale_packet_price,
  m.sale_price_per_cup,
  m.packets_quantity,
  m.box_quantity,
  m.line_total_amount,
  m.created_at,
  m.updated_at
from mapped m
where not exists (
  select 1 from public.sales_line_items sli where sli.source_sale_id = m.sale_id
);

-- Final recalc after line inserts.
update public.sales_entries se
set total_amount = coalesce(x.sum_amount, 0)
from (
  select sale_entry_id, sum(coalesce(total_amount, 0))::numeric(14,2) as sum_amount
  from public.sales_line_items
  group by sale_entry_id
) x
where x.sale_entry_id = se.sale_entry_id;
