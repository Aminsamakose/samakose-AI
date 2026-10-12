-- 0047: Allow Zoom as a calendar_connections / calendar_events provider.
-- Needed so a real Zoom-created meeting can be represented as what it is, rather than mislabeled
-- as INTERNAL. Additive only: widens two CHECK constraints, no data migration required.

alter table public.calendar_connections drop constraint if exists calendar_connection_provider_ck;
alter table public.calendar_connections add constraint calendar_connection_provider_ck
  check (provider in ('GOOGLE','MICROSOFT','ICS','INTERNAL','ZOOM'));

alter table public.calendar_events drop constraint if exists calendar_event_provider_ck;
alter table public.calendar_events add constraint calendar_event_provider_ck
  check (provider in ('GOOGLE','MICROSOFT','ICS','INTERNAL','ZOOM'));
