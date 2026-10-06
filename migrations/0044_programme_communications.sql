-- 0044: Programme communications and notifications.
-- Staging-gated; no production migration is implied by this file.

create table if not exists public.notification_templates (
  id uuid primary key default gen_random_uuid(),
  programme_id uuid references public.programmes(id) on delete cascade,
  key text not null,
  channel text not null default 'IN_APP',
  subject text,
  body text not null,
  active text not null default 'true',
  version text not null default '1',
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint notification_template_channel_ck check (channel in ('IN_APP','EMAIL','SMS','WHATSAPP'))
);
create index if not exists notification_template_programme_idx on public.notification_templates(programme_id, key, channel);

create table if not exists public.notification_preferences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  programme_id uuid references public.programmes(id) on delete cascade,
  channel text not null,
  enabled text not null default 'true',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint notification_pref_channel_ck check (channel in ('IN_APP','EMAIL','SMS','WHATSAPP'))
);
create unique index if not exists notification_pref_uq on public.notification_preferences(user_id, coalesce(programme_id, '00000000-0000-0000-0000-000000000000'::uuid), channel);

create table if not exists public.notification_events (
  id uuid primary key default gen_random_uuid(),
  programme_id uuid references public.programmes(id) on delete cascade,
  cohort_id uuid references public.cohorts(id) on delete cascade,
  event_type text not null,
  entity_type text not null,
  entity_id uuid,
  payload jsonb not null default '{}'::jsonb,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now()
);
create index if not exists notification_event_scope_idx on public.notification_events(programme_id, cohort_id, event_type, created_at);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  event_id uuid references public.notification_events(id) on delete set null,
  programme_id uuid references public.programmes(id) on delete cascade,
  cohort_id uuid references public.cohorts(id) on delete cascade,
  recipient_user_id uuid not null references public.users(id) on delete cascade,
  channel text not null default 'IN_APP',
  template_key text,
  subject text,
  body text not null,
  status text not null default 'PENDING',
  read_at timestamptz,
  sent_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint notification_channel_ck check (channel in ('IN_APP','EMAIL','SMS','WHATSAPP')),
  constraint notification_status_ck check (status in ('PENDING','SENT','DELIVERED','FAILED','READ','CANCELLED'))
);
create index if not exists notification_recipient_idx on public.notifications(recipient_user_id, status, created_at);
create index if not exists notification_scope_idx on public.notifications(programme_id, cohort_id, status);

create table if not exists public.notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null references public.notifications(id) on delete cascade,
  channel text not null,
  status text not null default 'QUEUED',
  provider text,
  provider_message_id text,
  attempts text not null default '0',
  next_attempt_at timestamptz,
  delivered_at timestamptz,
  error text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint notification_delivery_channel_ck check (channel in ('IN_APP','EMAIL','SMS','WHATSAPP')),
  constraint notification_delivery_status_ck check (status in ('QUEUED','SENDING','SENT','DELIVERED','FAILED','RETRYING'))
);
create index if not exists notification_delivery_idx on public.notification_deliveries(notification_id, status, next_attempt_at);

alter table public.notification_templates enable row level security;
alter table public.notification_preferences enable row level security;
alter table public.notification_events enable row level security;
alter table public.notifications enable row level security;
alter table public.notification_deliveries enable row level security;

-- Application authorization/scoping is enforced by the service layer. No broad client policies are added.
