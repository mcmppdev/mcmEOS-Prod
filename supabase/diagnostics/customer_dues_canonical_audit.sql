-- Read-only diagnostic for Customer Dues matching.
-- Replace the environment value in params with 'prod' or 'dev' as needed.

with params as (
  select 'prod'::text as source_env
),
sales_rows as (
  select
    coalesce(
      nullif(c.cid, ''),
      nullif(s.cid, ''),
      nullif(s.aid, ''),
      nullif(regexp_replace(coalesce(s.customer_mobile_snapshot, ''), '\D', '', 'g'), ''),
      nullif(lower(trim(coalesce(s.company_name_snapshot, ''))), ''),
      'sale:' || s.sale_entry_id
    ) as customer_key,
    s.sale_entry_id as record_id,
    'sale'::text as record_type,
    s.cid,
    s.aid,
    s.customer_name_snapshot,
    s.company_name_snapshot,
    s.customer_mobile_snapshot,
    coalesce(s.total_amount, 0)::numeric as total_sales,
    0::numeric as total_paid
  from public.sales_entries s
  cross join params p
  left join lateral (
    select c.*
    from public.contacts c
    where c.source_env = s.source_env
      and (
        (nullif(s.cid, '') is not null and c.cid = s.cid)
        or (nullif(s.cid, '') is null and nullif(s.aid, '') is not null and c.aid = s.aid)
        or (
          nullif(s.cid, '') is null
          and nullif(s.aid, '') is null
          and nullif(regexp_replace(coalesce(s.customer_mobile_snapshot, ''), '\D', '', 'g'), '') is not null
          and regexp_replace(coalesce(c.mobile, ''), '\D', '', 'g') = regexp_replace(coalesce(s.customer_mobile_snapshot, ''), '\D', '', 'g')
        )
      )
    order by
      case
        when nullif(s.cid, '') is not null and c.cid = s.cid then 0
        when nullif(s.aid, '') is not null and c.aid = s.aid then 1
        else 2
      end,
      c.created_at desc nulls last
    limit 1
  ) c on true
  where s.source_env = p.source_env
),
payment_rows as (
  select
    coalesce(
      nullif(c.cid, ''),
      nullif(cp.cid, ''),
      nullif(cp.aid, ''),
      nullif(regexp_replace(coalesce(cp.customer_mobile_snapshot, ''), '\D', '', 'g'), ''),
      nullif(lower(trim(coalesce(cp.company_name_snapshot, ''))), ''),
      'payment:' || cp.payment_id
    ) as customer_key,
    cp.payment_id as record_id,
    'payment'::text as record_type,
    cp.cid,
    cp.aid,
    cp.customer_name_snapshot,
    cp.company_name_snapshot,
    cp.customer_mobile_snapshot,
    0::numeric as total_sales,
    coalesce(cp.amount_paid, 0)::numeric as total_paid
  from public.customer_payments cp
  cross join params p
  left join lateral (
    select c.*
    from public.contacts c
    where c.source_env = cp.source_env
      and (
        (nullif(cp.cid, '') is not null and c.cid = cp.cid)
        or (nullif(cp.cid, '') is null and nullif(cp.aid, '') is not null and c.aid = cp.aid)
        or (
          nullif(cp.cid, '') is null
          and nullif(cp.aid, '') is null
          and nullif(regexp_replace(coalesce(cp.customer_mobile_snapshot, ''), '\D', '', 'g'), '') is not null
          and regexp_replace(coalesce(c.mobile, ''), '\D', '', 'g') = regexp_replace(coalesce(cp.customer_mobile_snapshot, ''), '\D', '', 'g')
        )
      )
    order by
      case
        when nullif(cp.cid, '') is not null and c.cid = cp.cid then 0
        when nullif(cp.aid, '') is not null and c.aid = cp.aid then 1
        else 2
      end,
      c.created_at desc nulls last
    limit 1
  ) c on true
  where cp.source_env = p.source_env
),
combined as (
  select * from sales_rows
  union all
  select * from payment_rows
),
summary as (
  select
    customer_key,
    max(customer_name_snapshot) as customer_name,
    max(company_name_snapshot) as company_name,
    max(customer_mobile_snapshot) as mobile,
    sum(total_sales)::numeric as total_sales,
    sum(total_paid)::numeric as total_paid,
    (sum(total_sales) - sum(total_paid))::numeric as balance,
    jsonb_agg(
      jsonb_build_object(
        'type', record_type,
        'id', record_id,
        'cid', cid,
        'aid', aid,
        'customer', customer_name_snapshot,
        'company', company_name_snapshot,
        'mobile', customer_mobile_snapshot,
        'sales', total_sales,
        'paid', total_paid
      )
      order by record_type, record_id
    ) as matched_records
  from combined
  group by customer_key
)
select *
from summary
where total_sales <> 0 or total_paid <> 0
order by balance desc, customer_name asc;
