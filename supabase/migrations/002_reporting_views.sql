create or replace view public.customer_balances as
with sales_totals as (
  select
    cid,
    company_name_snapshot,
    max(customer_name_snapshot) as customer_name_snapshot,
    max(customer_mobile_snapshot) as customer_mobile_snapshot,
    sum(coalesce(total_amount, 0)) as total_sales
  from public.sales
  group by cid, company_name_snapshot
),
payment_totals as (
  select
    cid,
    company_name_snapshot,
    max(customer_name_snapshot) as customer_name_snapshot,
    max(customer_mobile_snapshot) as customer_mobile_snapshot,
    sum(coalesce(amount_paid, 0)) as total_paid
  from public.customer_payments
  group by cid, company_name_snapshot
)
select
  coalesce(s.cid, p.cid) as cid,
  coalesce(s.company_name_snapshot, p.company_name_snapshot) as company_name,
  coalesce(s.customer_name_snapshot, p.customer_name_snapshot) as customer_name,
  coalesce(s.customer_mobile_snapshot, p.customer_mobile_snapshot) as customer_mobile,
  coalesce(s.total_sales, 0) as total_sales,
  coalesce(p.total_paid, 0) as total_paid,
  coalesce(s.total_sales, 0) - coalesce(p.total_paid, 0) as balance
from sales_totals s
full outer join payment_totals p
  on p.cid = s.cid;

create or replace view public.customer_ledger_entries as
select
  sale_date as entry_date,
  cid,
  aid,
  company_name_snapshot,
  customer_name_snapshot,
  customer_mobile_snapshot,
  'sale' as entry_type,
  total_amount as debit,
  0::numeric as credit,
  sale_id as source_id
from public.sales
union all
select
  payment_date as entry_date,
  cid,
  aid,
  company_name_snapshot,
  customer_name_snapshot,
  customer_mobile_snapshot,
  'payment' as entry_type,
  0::numeric as debit,
  amount_paid as credit,
  payment_id::text as source_id
from public.customer_payments;

