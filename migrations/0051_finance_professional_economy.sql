-- 0051: Professional Economy & Financial Architecture (Master Directive §31-54).
-- Schema only, inert: no service or API route writes to these tables yet (rollout step 1
-- of "Finance & Professional Economy Design"). No production migration is implied.

create sequence if not exists public.seq_rsa;
create sequence if not exists public.seq_rsc;
create sequence if not exists public.seq_pyo;
create sequence if not exists public.seq_rfd;

/* ---------------------------- revenue share ---------------------------- */

create table if not exists public.revenue_share_agreements (
  id uuid primary key default gen_random_uuid(),
  code text not null unique default ('RSA-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.seq_rsa')::text, 6, '0')),
  contract_id uuid not null references public.contracts(id),
  assignment_id uuid not null references public.case_assignments(id),
  professional_id uuid not null references public.users(id),
  model text not null check (model in ('PERCENTAGE','FIXED','TIERED','HYBRID')),
  basis text not null check (basis in ('SHARE_ON_LIST_PRICE','SHARE_ON_NET_PRICE','SHARE_ON_COLLECTED_AMOUNT')),
  percentage numeric(5,2),
  fixed_amount_ghs numeric(12,2),
  tier_rules jsonb,
  status text not null default 'Draft' check (status in ('Draft','Pending approval','Approved','Active','Suspended','Expired','Cancelled')),
  proposed_by uuid references public.users(id),
  approved_by uuid references public.users(id),
  approved_at timestamptz,
  effective_from date,
  effective_to date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint rsa_model_amount_ck check (
    (model = 'PERCENTAGE' and percentage is not null) or
    (model = 'FIXED' and fixed_amount_ghs is not null) or
    (model in ('TIERED','HYBRID') and (tier_rules is not null or percentage is not null or fixed_amount_ghs is not null))
  )
);
create index if not exists rsa_contract_idx on public.revenue_share_agreements(contract_id);
create index if not exists rsa_assignment_idx on public.revenue_share_agreements(assignment_id);
create index if not exists rsa_professional_idx on public.revenue_share_agreements(professional_id);

create table if not exists public.revenue_share_allocations (
  id uuid primary key default gen_random_uuid(),
  agreement_id uuid not null references public.revenue_share_agreements(id) on delete cascade,
  allocatee_role text not null check (allocatee_role in ('SAMAKOSE','LEAD','SPECIALIST','COACH','REVIEWER')),
  professional_id uuid references public.users(id),
  percent_of_share numeric(5,2) not null check (percent_of_share > 0 and percent_of_share <= 100),
  created_at timestamptz not null default now(),
  constraint rsal_samakose_no_professional_ck check (allocatee_role <> 'SAMAKOSE' or professional_id is null),
  constraint rsal_professional_required_ck check (allocatee_role = 'SAMAKOSE' or professional_id is not null)
);
create index if not exists rsal_agreement_idx on public.revenue_share_allocations(agreement_id);

-- An agreement's allocations must sum to exactly 100%. Checked whenever a row in that agreement changes,
-- not just on insert, so an edit or delete that breaks the total is caught too.
create or replace function public.check_revenue_share_allocation_total() returns trigger language plpgsql as $$
declare
  target_agreement uuid := coalesce(new.agreement_id, old.agreement_id);
  total numeric(6,2);
begin
  select coalesce(sum(percent_of_share), 0) into total from public.revenue_share_allocations where agreement_id = target_agreement;
  if total <> 100 then
    raise exception 'Revenue share allocations for agreement % must sum to 100%%, got %', target_agreement, total;
  end if;
  return null;
end $$;
drop trigger if exists rsal_total_check on public.revenue_share_allocations;
create constraint trigger rsal_total_check after insert or update or delete on public.revenue_share_allocations
  deferrable initially deferred for each row execute function public.check_revenue_share_allocation_total();

-- The immutable snapshot taken at financial activation (Directive §34). A correction is a new row
-- referencing supersedes_id; existing rows are never updated once created.
create table if not exists public.revenue_share_calculations (
  id uuid primary key default gen_random_uuid(),
  code text not null unique default ('RSC-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.seq_rsc')::text, 6, '0')),
  agreement_id uuid not null references public.revenue_share_agreements(id),
  invoice_id uuid references public.invoices(id),
  payment_id uuid references public.payments(id),
  gross_amount_ghs numeric(12,2) not null,
  discount_amount_ghs numeric(12,2) not null default 0,
  net_amount_ghs numeric(12,2) not null,
  basis_used text not null check (basis_used in ('SHARE_ON_LIST_PRICE','SHARE_ON_NET_PRICE','SHARE_ON_COLLECTED_AMOUNT')),
  calculation_version integer not null default 1,
  professional_amount_ghs numeric(12,2) not null,
  samakose_amount_ghs numeric(12,2) not null,
  currency text not null default 'GHS',
  supersedes_id uuid references public.revenue_share_calculations(id),
  computed_by uuid,
  approved_by uuid references public.users(id),
  approved_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists rscalc_agreement_idx on public.revenue_share_calculations(agreement_id);
create index if not exists rscalc_invoice_idx on public.revenue_share_calculations(invoice_id);
create or replace function public.reject_calculation_change() returns trigger language plpgsql as $$
begin raise exception 'A revenue-share calculation is an immutable snapshot; create a new row referencing supersedes_id instead'; end $$;
drop trigger if exists revenue_share_calculations_immutable on public.revenue_share_calculations;
create trigger revenue_share_calculations_immutable before update or delete on public.revenue_share_calculations
for each row execute function public.reject_calculation_change();

/* --------------------------- professional payouts ------------------------ */

create table if not exists public.professional_payouts (
  id uuid primary key default gen_random_uuid(),
  code text not null unique default ('PYO-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.seq_pyo')::text, 6, '0')),
  professional_id uuid not null references public.users(id),
  calculation_id uuid not null references public.revenue_share_calculations(id),
  assignment_id uuid not null references public.case_assignments(id),
  contract_id uuid not null references public.contracts(id),
  amount_ghs numeric(12,2) not null,
  currency text not null default 'GHS',
  status text not null default 'Earned' check (status in ('Earned','Reviewed','Approved','Payable','Payment initiated','Paid','Reconciled')),
  payout_method text,
  payment_reference text,
  reviewed_by uuid references public.users(id),
  reviewed_at timestamptz,
  approved_by uuid references public.users(id),
  approved_at timestamptz,
  paid_at timestamptz,
  reconciled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pyo_reviewer_not_professional_ck check (reviewed_by is null or reviewed_by <> professional_id),
  constraint pyo_approver_not_professional_ck check (approved_by is null or approved_by <> professional_id)
);
create index if not exists pyo_professional_idx on public.professional_payouts(professional_id, status);
create index if not exists pyo_calculation_idx on public.professional_payouts(calculation_id);

create table if not exists public.payout_holds (
  id uuid primary key default gen_random_uuid(),
  payout_id uuid not null references public.professional_payouts(id),
  reason text not null,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  resolved_by uuid references public.users(id),
  resolved_at timestamptz,
  resolution_note text
);
create index if not exists ph_payout_idx on public.payout_holds(payout_id);
create index if not exists ph_open_idx on public.payout_holds(payout_id) where resolved_at is null;

create table if not exists public.payout_adjustments (
  id uuid primary key default gen_random_uuid(),
  payout_id uuid not null references public.professional_payouts(id),
  type text not null check (type in ('CORRECTION','REVERSAL','REFUND_CLAWBACK')),
  amount_ghs numeric(12,2) not null,
  reason text not null,
  created_by uuid references public.users(id),
  approved_by uuid references public.users(id),
  ledger_entry_id uuid,
  created_at timestamptz not null default now()
);
create index if not exists pa_payout_idx on public.payout_adjustments(payout_id);

/* ------------------------- financial ledger & periods --------------------- */

create table if not exists public.financial_accounts (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  type text not null check (type in ('ASSET','LIABILITY','REVENUE','EXPENSE','EQUITY')),
  created_at timestamptz not null default now()
);

create table if not exists public.financial_periods (
  id uuid primary key default gen_random_uuid(),
  label text not null unique,
  start_date date not null,
  end_date date not null,
  status text not null default 'Open' check (status in ('Open','Closing','Closed','Locked')),
  closed_by uuid references public.users(id),
  closed_at timestamptz,
  constraint fp_dates_ck check (end_date >= start_date)
);

-- Double-entry, append-only (Directive §40). The database role gets INSERT/SELECT only; no UPDATE/DELETE
-- grant exists on this table, closing the application-discipline-only gap flagged in the audit for audit_log.
create table if not exists public.financial_ledger_entries (
  id bigserial primary key,
  account_id uuid not null references public.financial_accounts(id),
  debit_ghs numeric(12,2) not null default 0,
  credit_ghs numeric(12,2) not null default 0,
  currency text not null default 'GHS',
  reference_type text not null check (reference_type in ('INVOICE','PAYMENT','REVENUE_SHARE','PAYOUT','REFUND','ADJUSTMENT')),
  reference_id uuid not null,
  description text,
  period_id uuid not null references public.financial_periods(id),
  created_by uuid,
  created_at timestamptz not null default now(),
  constraint fle_one_sided_ck check ((debit_ghs = 0 and credit_ghs > 0) or (credit_ghs = 0 and debit_ghs > 0))
);
create index if not exists fle_account_idx on public.financial_ledger_entries(account_id);
create index if not exists fle_reference_idx on public.financial_ledger_entries(reference_type, reference_id);
create index if not exists fle_period_idx on public.financial_ledger_entries(period_id);
create or replace function public.reject_ledger_change() returns trigger language plpgsql as $$
begin raise exception 'The financial ledger is append-only; post an ADJUSTMENT, REVERSAL or CORRECTION entry instead'; end $$;
drop trigger if exists financial_ledger_entries_immutable on public.financial_ledger_entries;
create trigger financial_ledger_entries_immutable before update or delete on public.financial_ledger_entries
for each row execute function public.reject_ledger_change();

-- A closed or locked period refuses any new entry dated into it; corrections post into the open period instead.
create or replace function public.reject_entry_into_closed_period() returns trigger language plpgsql as $$
declare period_status text;
begin
  select status into period_status from public.financial_periods where id = new.period_id;
  if period_status in ('Closed','Locked') then
    raise exception 'Financial period % is % and cannot accept new ledger entries', new.period_id, period_status;
  end if;
  return new;
end $$;
drop trigger if exists financial_ledger_entries_period_guard on public.financial_ledger_entries;
create trigger financial_ledger_entries_period_guard before insert on public.financial_ledger_entries
for each row execute function public.reject_entry_into_closed_period();

/* ---------------------------- discounts & promos --------------------------- */

create table if not exists public.discount_rules (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('PERCENTAGE','FIXED','PROMOTIONAL_PRICE')),
  value numeric(12,2) not null,
  conditions jsonb,
  active boolean not null default true,
  created_by uuid references public.users(id),
  approved_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.promo_campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  discount_rule_id uuid not null references public.discount_rules(id),
  start_date date,
  end_date date,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint pcamp_dates_ck check (end_date is null or start_date is null or end_date >= start_date)
);

create table if not exists public.promo_codes (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.promo_campaigns(id),
  code text not null unique,
  max_redemptions integer check (max_redemptions is null or max_redemptions > 0),
  per_customer_limit integer check (per_customer_limit is null or per_customer_limit > 0),
  min_purchase_ghs numeric(12,2),
  max_discount_ghs numeric(12,2),
  expires_at timestamptz,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists pc_campaign_idx on public.promo_codes(campaign_id);

create table if not exists public.promo_redemptions (
  id uuid primary key default gen_random_uuid(),
  promo_code_id uuid not null references public.promo_codes(id),
  invoice_id uuid not null references public.invoices(id),
  customer_id uuid not null references public.users(id),
  discount_applied_ghs numeric(12,2) not null,
  redeemed_at timestamptz not null default now(),
  constraint pr_code_customer_uq unique (promo_code_id, customer_id)
);

/* ------------------------------- tax rules --------------------------------- */

create table if not exists public.tax_rules (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('VAT','WITHHOLDING','OTHER')),
  rate numeric(5,2) not null,
  jurisdiction text not null,
  inclusive_of_price boolean not null default false,
  rule_version integer not null default 1,
  effective_from date not null,
  effective_to date,
  created_at timestamptz not null default now(),
  constraint tr_dates_ck check (effective_to is null or effective_to >= effective_from)
);
create index if not exists tr_type_jurisdiction_idx on public.tax_rules(type, jurisdiction);

create table if not exists public.tax_lines (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid references public.invoices(id),
  payout_id uuid references public.professional_payouts(id),
  tax_rule_id uuid not null references public.tax_rules(id),
  base_amount_ghs numeric(12,2) not null,
  amount_ghs numeric(12,2) not null,
  rule_version integer not null,
  created_at timestamptz not null default now(),
  constraint tl_one_target_ck check ((invoice_id is not null) <> (payout_id is not null))
);
create index if not exists tl_invoice_idx on public.tax_lines(invoice_id);
create index if not exists tl_payout_idx on public.tax_lines(payout_id);

/* --------------------------- refunds & chargebacks -------------------------- */

create table if not exists public.refunds (
  id uuid primary key default gen_random_uuid(),
  code text not null unique default ('RFD-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.seq_rfd')::text, 6, '0')),
  payment_id uuid not null references public.payments(id),
  invoice_id uuid not null references public.invoices(id),
  amount_ghs numeric(12,2) not null,
  reason text not null,
  status text not null default 'Requested' check (status in ('Requested','Approved','Processed','Rejected')),
  requested_by uuid references public.users(id),
  approved_by uuid references public.users(id),
  processed_at timestamptz,
  ledger_entry_id uuid,
  created_at timestamptz not null default now(),
  constraint refund_approver_not_requester_ck check (approved_by is null or requested_by is null or approved_by <> requested_by)
);
create index if not exists rf_payment_idx on public.refunds(payment_id);

create table if not exists public.chargebacks (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments(id),
  amount_ghs numeric(12,2) not null,
  provider text not null,
  provider_reference text,
  status text not null default 'Received',
  received_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index if not exists cb_payment_idx on public.chargebacks(payment_id);

/* ------------------------- approvals & conflict checks ----------------------- */

create table if not exists public.approval_requests (
  id uuid primary key default gen_random_uuid(),
  action_type text not null check (action_type in ('DISCOUNT_EXCEPTION','REVENUE_SHARE_OVERRIDE','PAYOUT','REFUND','LEDGER_ADJUSTMENT','CONTRACT')),
  reference_id uuid not null,
  requested_by uuid not null references public.users(id),
  amount_ghs numeric(12,2),
  required_approver_role text,
  status text not null default 'Pending' check (status in ('Pending','Approved','Rejected')),
  created_at timestamptz not null default now()
);
create index if not exists ar_action_idx on public.approval_requests(action_type, reference_id);
create index if not exists ar_status_idx on public.approval_requests(status);

create table if not exists public.approval_decisions (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.approval_requests(id),
  decision text not null check (decision in ('Approved','Rejected')),
  decided_by uuid not null references public.users(id),
  decided_at timestamptz not null default now(),
  reason text,
  before_value jsonb,
  after_value jsonb
);
create index if not exists ad_request_idx on public.approval_decisions(request_id);

-- Four-eyes, enforced in the database as a backstop to the service-layer check: a request's own requester
-- can never be recorded as its decider.
create or replace function public.reject_self_approval() returns trigger language plpgsql as $$
declare requester uuid;
begin
  select requested_by into requester from public.approval_requests where id = new.request_id;
  if requester = new.decided_by then
    raise exception 'Approval request % cannot be decided by its own requester (four-eyes violation)', new.request_id;
  end if;
  return new;
end $$;
drop trigger if exists approval_decisions_four_eyes on public.approval_decisions;
create trigger approval_decisions_four_eyes before insert on public.approval_decisions
for each row execute function public.reject_self_approval();

create table if not exists public.conflict_checks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id),
  context_type text not null check (context_type in ('REVENUE_SHARE_APPROVAL','PAYOUT_APPROVAL','REVIEW','COMMERCIAL_EXCEPTION')),
  reference_id uuid not null,
  result text not null check (result in ('CLEAR','BLOCKED')),
  reason text,
  checked_at timestamptz not null default now()
);
create index if not exists cc_user_idx on public.conflict_checks(user_id);
create index if not exists cc_reference_idx on public.conflict_checks(context_type, reference_id);

/* ------------------------------------- RLS & ownership ------------------------------------- */

alter table public.revenue_share_agreements enable row level security;
alter table public.revenue_share_allocations enable row level security;
alter table public.revenue_share_calculations enable row level security;
alter table public.professional_payouts enable row level security;
alter table public.payout_holds enable row level security;
alter table public.payout_adjustments enable row level security;
alter table public.financial_accounts enable row level security;
alter table public.financial_periods enable row level security;
alter table public.financial_ledger_entries enable row level security;
alter table public.discount_rules enable row level security;
alter table public.promo_campaigns enable row level security;
alter table public.promo_codes enable row level security;
alter table public.promo_redemptions enable row level security;
alter table public.tax_rules enable row level security;
alter table public.tax_lines enable row level security;
alter table public.refunds enable row level security;
alter table public.chargebacks enable row level security;
alter table public.approval_requests enable row level security;
alter table public.approval_decisions enable row level security;
alter table public.conflict_checks enable row level security;

-- Keep application ownership consistent with migration 0018 on environments that use samakose_app.
-- Local/test environments without this role are intentionally left unchanged.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'samakose_app') THEN
    ALTER TABLE public.revenue_share_agreements OWNER TO samakose_app;
    ALTER TABLE public.revenue_share_allocations OWNER TO samakose_app;
    ALTER TABLE public.revenue_share_calculations OWNER TO samakose_app;
    ALTER TABLE public.professional_payouts OWNER TO samakose_app;
    ALTER TABLE public.payout_holds OWNER TO samakose_app;
    ALTER TABLE public.payout_adjustments OWNER TO samakose_app;
    ALTER TABLE public.financial_accounts OWNER TO samakose_app;
    ALTER TABLE public.financial_periods OWNER TO samakose_app;
    ALTER TABLE public.financial_ledger_entries OWNER TO samakose_app;
    ALTER TABLE public.discount_rules OWNER TO samakose_app;
    ALTER TABLE public.promo_campaigns OWNER TO samakose_app;
    ALTER TABLE public.promo_codes OWNER TO samakose_app;
    ALTER TABLE public.promo_redemptions OWNER TO samakose_app;
    ALTER TABLE public.tax_rules OWNER TO samakose_app;
    ALTER TABLE public.tax_lines OWNER TO samakose_app;
    ALTER TABLE public.refunds OWNER TO samakose_app;
    ALTER TABLE public.chargebacks OWNER TO samakose_app;
    ALTER TABLE public.approval_requests OWNER TO samakose_app;
    ALTER TABLE public.approval_decisions OWNER TO samakose_app;
    ALTER TABLE public.conflict_checks OWNER TO samakose_app;
    ALTER FUNCTION public.check_revenue_share_allocation_total() OWNER TO samakose_app;
    ALTER FUNCTION public.reject_calculation_change() OWNER TO samakose_app;
    ALTER FUNCTION public.reject_ledger_change() OWNER TO samakose_app;
    ALTER FUNCTION public.reject_entry_into_closed_period() OWNER TO samakose_app;
    ALTER FUNCTION public.reject_self_approval() OWNER TO samakose_app;

    -- financial_ledger_entries is append-only even for the application role itself: no UPDATE/DELETE grant,
    -- closing the gap the audit flagged for audit_log (where immutability was application discipline only).
    REVOKE UPDATE, DELETE ON public.financial_ledger_entries FROM samakose_app;
  END IF;
END $$;
