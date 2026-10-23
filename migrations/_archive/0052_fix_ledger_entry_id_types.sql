-- 0052: fixes a type mismatch from migration 0051. refunds.ledger_entry_id and
-- payout_adjustments.ledger_entry_id were typed uuid, but financial_ledger_entries.id is bigserial
-- (bigint) - the two could never actually be linked through that column. Both columns are part of
-- the still-inert tax/refunds rollout step (no write path lived until the "Tax Rules, Refunds and
-- Chargebacks" PR, and that PR left the columns unset rather than attempt an insert Postgres would
-- reject), so this is a safe column-type fix with no data to migrate.
alter table public.refunds drop column if exists ledger_entry_id;
alter table public.refunds add column ledger_entry_id bigint references public.financial_ledger_entries(id);

alter table public.payout_adjustments drop column if exists ledger_entry_id;
alter table public.payout_adjustments add column ledger_entry_id bigint references public.financial_ledger_entries(id);
