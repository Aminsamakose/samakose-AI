-- 0053: records whether a practitioner (EXPERT/COACH/REVIEWER) is engaged as an independent contractor
-- ("Associate", the default) or as payroll staff ("Employee"). This is a classification field only -
-- it changes nothing about the role, RBAC or case-assignment model, which stays exactly as it is.
-- Administrator-set only; practitioners never self-declare their own classification (enforced in
-- practitioners.ts, not here).
alter table public.practitioner_profiles add column engagement_type text not null default 'Associate';
alter table public.practitioner_profiles add constraint pp_engagement_type_ck check (engagement_type in ('Associate', 'Employee'));
