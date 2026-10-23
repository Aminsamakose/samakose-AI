-- 0055: Business Doctor Resource Library, Phase 4. A resource purchase's own payment row, standalone
-- from invoices (which require an organisation - a Library buyer may be an individual with no org).
-- Shares the one Paystack account and webhook signature-verification logic already in finance.ts;
-- this is the same payment rail, not a new one, just a row shape that does not need an invoice.

create table if not exists public.resource_payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id),
  resource_id uuid not null references public.library_resources(id),
  reference text not null unique,
  amount_ghs numeric(10,2) not null,
  status text not null default 'Pending',
  provider_payload jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint res_pay_status_ck check (status in ('Pending', 'Succeeded', 'Failed'))
);
create index if not exists res_pay_resource_idx on public.resource_payments(resource_id);
create index if not exists res_pay_user_idx on public.resource_payments(user_id);

alter table public.resource_payments enable row level security;
