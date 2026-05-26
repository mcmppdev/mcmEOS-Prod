alter table if exists public.accounts
  add column if not exists address text,
  add column if not exists state text,
  add column if not exists zipcode text,
  add column if not exists gst_number text,
  add column if not exists created_by_user_id text references public.app_users(user_id),
  add column if not exists created_by_name text,
  add column if not exists updated_by_user_id text references public.app_users(user_id),
  add column if not exists updated_by_name text;

insert into public.accounts (
  aid,
  cid,
  contact_name,
  company,
  account_status,
  mobile,
  city,
  state,
  address,
  zipcode,
  gst_number
)
select
  coalesce(nullif(c.aid, ''), 'AID-' || regexp_replace(c.cid, '[^A-Za-z0-9]+', '-', 'g')),
  c.cid,
  c.name,
  c.company,
  coalesce(nullif(c.contact_status, ''), 'Active'),
  c.mobile,
  c.city,
  c.state,
  '',
  '',
  ''
from public.contacts c
where not exists (
  select 1
  from public.accounts a
  where a.aid = c.aid
     or a.cid = c.cid
)
on conflict (aid) do nothing;

update public.contacts c
set aid = a.aid
from public.accounts a
where a.cid = c.cid
  and (c.aid is null or c.aid = '');

create index if not exists idx_accounts_cid on public.accounts(cid);
create index if not exists idx_accounts_aid_cid on public.accounts(aid, cid);
