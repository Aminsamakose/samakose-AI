-- 0066: Programme expenditure ledger tied to budget lines (funder-accountability gap register, GAP 16).
-- Distinct from financial_ledger_entries (the commercial double-entry ledger in services/ledger.ts,
-- which posts Samakose's own invoice/payment/revenue entries, not a programme's spend against a
-- funder's budget). Commitments, payments and reversals are separate rows, never edited in place:
-- a payment settles a commitment by flipping it to SETTLED (settles_commitment_id), a reversal
-- flips what it reverses to REVERSED (reversal_of_id) -- so totals can always be reproduced from
-- these rows alone.
create table if not exists public.programme_expenditures (
  id uuid primary key default gen_random_uuid(),
  programme_id uuid not null references public.programmes(id),
  budget_line_id uuid references public.programme_budget_lines(id),
  cohort_id uuid references public.cohorts(id),
  type text not null default 'PAYMENT' check (type in ('COMMITMENT','PAYMENT','REVERSAL')),
  payee text not null,
  category text not null,
  purpose text,
  amount_ghs numeric(14,2) not null check (amount_ghs > 0),
  date date not null,
  reference text,
  evidence_class evidence_class not null default 'Document-supported',
  evidence_ref text,
  settles_commitment_id uuid,
  reversal_of_id uuid,
  status text not null default 'ACTIVE' check (status in ('ACTIVE','SETTLED','REVERSED')),
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists prog_exp_programme_idx on public.programme_expenditures (programme_id);
create index if not exists prog_exp_budget_line_idx on public.programme_expenditures (budget_line_id);
create index if not exists prog_exp_settles_idx on public.programme_expenditures (settles_commitment_id);
create index if not exists prog_exp_reversal_idx on public.programme_expenditures (reversal_of_id);
create unique index if not exists prog_exp_reference_uq
  on public.programme_expenditures (programme_id, reference) where (reference is not null);

alter table public.programme_expenditures enable row level security;

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'samakose_app') then
    alter table public.programme_expenditures owner to samakose_app;
  end if;
end $$;
