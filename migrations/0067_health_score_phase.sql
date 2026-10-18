-- 0067: Baseline/midline/endline tagging on health scores (funder-accountability gap register).
-- "Baseline" was previously inferred positionally (run = 1), which breaks the moment a round is
-- skipped, repeated or re-ordered. phase is now set explicitly at scoring time from the case's
-- lifecycle state (computeScore in services/diagnostics.ts): the first score a case ever gets is
-- always BASELINE; a score taken while the case sits in MIDLINE or ENDLINE carries that label;
-- anything else is OTHER. Existing rows are backfilled on the one rule that can be inferred safely
-- after the fact -- run 1 was, and remains, the baseline -- and otherwise left OTHER rather than
-- guessed, since we cannot recover what case-status a past row was scored under.
alter table public.health_scores
  add column if not exists phase text not null default 'OTHER'
  check (phase in ('BASELINE','MIDLINE','ENDLINE','OTHER'));

update public.health_scores set phase = 'BASELINE' where run = 1 and phase = 'OTHER';
