-- 0054: Business Doctor Resource Library. Additive only: a free/premium catalogue of resources,
-- authored, reviewed and published through the same draft -> review -> publish discipline as
-- site content. Purchases flow through the existing invoices/payments tables. See the Phase 0
-- assessment delivered for this build for the architecture decision this schema follows.

create table if not exists public.library_authors (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  title text,
  bio text,
  photo_media_id uuid references public.media_assets(id),
  user_id uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.library_resources (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  author_id uuid not null references public.library_authors(id),
  topic text,
  dimension text,
  summary text not null default '',
  body text not null default '',
  cover_media_id uuid references public.media_assets(id),
  file_storage_key text,
  file_mime text,
  file_size integer,
  price_ghs numeric(10,2),
  status text not null default 'Draft',
  publish_at timestamptz,
  published_at timestamptz,
  created_by uuid references public.users(id),
  approved_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint lib_res_status_ck check (status in ('Draft', 'In review', 'Published', 'Archived')),
  constraint lib_res_price_ck check (price_ghs is null or price_ghs >= 0)
);
create index if not exists lib_res_status_idx on public.library_resources(status);
create index if not exists lib_res_author_idx on public.library_resources(author_id);
create index if not exists lib_res_dimension_idx on public.library_resources(dimension);

create table if not exists public.resource_entitlements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id),
  resource_id uuid not null references public.library_resources(id),
  granted_via text not null,
  invoice_id uuid references public.invoices(id),
  granted_by uuid references public.users(id),
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  constraint res_ent_granted_via_ck check (granted_via in ('purchase', 'promo', 'admin_grant'))
);
create unique index if not exists res_ent_user_res_uq on public.resource_entitlements(user_id, resource_id);
create index if not exists res_ent_resource_idx on public.resource_entitlements(resource_id);

-- The app connects via a direct Postgres role through Drizzle, not Supabase's RLS-governed
-- anon/authenticated client, so enabling RLS with no policy here matches every other table:
-- enforcement is RBAC in application code (src/lib/rbac.ts), not Postgres row security.
alter table public.library_authors enable row level security;
alter table public.library_resources enable row level security;
alter table public.resource_entitlements enable row level security;
