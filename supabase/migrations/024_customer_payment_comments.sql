alter table public.customer_payments
  add column if not exists comments text;
