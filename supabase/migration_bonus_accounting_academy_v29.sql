-- LSPD MDT v29: Academy rank eligibility + bonus payouts + accounting.

alter table public.academy_tests add column if not exists eligible_rank_ids jsonb not null default '[]'::jsonb;
create index if not exists academy_tests_eligible_rank_ids_idx on public.academy_tests using gin (eligible_rank_ids);

insert into public.permissions (id,key,name,label,description,category)
values
 ('PERM_ACCOUNTING_VIEW','accounting.view','Buchhaltung ansehen','Buchhaltung ansehen','Organisationskonto und Buchungsliste ansehen','Buchhaltung'),
 ('PERM_ACCOUNTING_MANAGE','accounting.manage','Buchhaltung verwalten','Buchhaltung verwalten','Buchungen und Kontostand verwalten','Buchhaltung')
on conflict (key) do update set name=excluded.name,label=excluded.label,description=excluded.description,category=excluded.category;

create table if not exists public.fib_bonus_payouts (
  id text primary key,
  employee_id text not null,
  employee_name text not null,
  rank_id text,
  rank_name text,
  rank_level integer not null default 0,
  event_count integer not null default 0,
  towing_count integer not null default 0,
  drugs_count integer not null default 0,
  entry_control_count integer not null default 0,
  total_amount numeric(12,2) not null default 0,
  status text not null default 'pending',
  evidence text,
  description text,
  activity_date timestamptz,
  rejection_reason text,
  submitted_at timestamptz not null default now(),
  created_by text,
  created_by_name text,
  reviewed_at timestamptz,
  reviewed_by text,
  reviewed_by_name text,
  paid_at timestamptz,
  paid_by text,
  paid_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists fib_bonus_payouts_employee_idx on public.fib_bonus_payouts(employee_id, submitted_at desc);
create index if not exists fib_bonus_payouts_status_idx on public.fib_bonus_payouts(status, submitted_at desc);

create table if not exists public.fib_org_account (
  id text primary key,
  balance numeric(14,2) not null default 0,
  updated_at timestamptz not null default now(),
  updated_by text
);
insert into public.fib_org_account(id,balance) values ('MAIN',0) on conflict (id) do nothing;

create table if not exists public.fib_accounting_entries (
  id text primary key,
  entry_type text not null,
  amount numeric(14,2) not null,
  purpose text not null,
  description text,
  reference_type text,
  reference_id text,
  created_by text,
  created_by_name text,
  created_at timestamptz not null default now()
);
create index if not exists fib_accounting_entries_created_idx on public.fib_accounting_entries(created_at desc);
create index if not exists fib_accounting_entries_type_idx on public.fib_accounting_entries(entry_type, created_at desc);

notify pgrst, 'reload schema';

-- Atomic bonus payout: locks the payout and organisation account so two concurrent
-- managers cannot pay the same bonus twice or overspend the account.
create or replace function public.lspd_pay_bonus_payout(
  p_bonus_id text,
  p_user_id text,
  p_user_name text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.fib_bonus_payouts%rowtype;
  a public.fib_org_account%rowtype;
  entry_id text;
  next_balance numeric(14,2);
begin
  select * into b from public.fib_bonus_payouts where id=p_bonus_id for update;
  if not found then raise exception 'Bonus-Einreichung nicht gefunden.'; end if;
  if b.status <> 'approved' then raise exception 'Nur genehmigte Bonusauszahlungen können ausgezahlt werden.'; end if;
  select * into a from public.fib_org_account where id='MAIN' for update;
  if not found then raise exception 'Organisationskonto ist nicht eingerichtet.'; end if;
  if a.balance < b.total_amount then raise exception 'Das Organisationskonto verfügt nicht über ausreichend Guthaben.'; end if;
  next_balance := a.balance - b.total_amount;
  update public.fib_org_account set balance=next_balance, updated_at=now(), updated_by=p_user_id where id='MAIN';
  entry_id := 'ACC' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,14));
  insert into public.fib_accounting_entries(id,entry_type,amount,purpose,description,reference_type,reference_id,created_by,created_by_name)
  values(entry_id,'expense',b.total_amount,'Bonusauszahlung – '||b.employee_name,coalesce(b.description,'Bonusauszahlung'),'bonus',b.id,p_user_id,p_user_name);
  update public.fib_bonus_payouts set status='paid',paid_at=now(),paid_by=p_user_id,paid_by_name=p_user_name,updated_at=now() where id=b.id;
  return jsonb_build_object('success',true,'balance',next_balance,'entry_id',entry_id);
end;
$$;
