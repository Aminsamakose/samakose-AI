# Samakose AI Business Health OS

Production web application for The Business Doctor: diagnose, score, prescribe, coach and report on enterprise health, with programme and finance modules. Next.js 16, TypeScript, PostgreSQL 16.

## Run it locally

```bash
npm ci
cp .env.example .env            # set DATABASE_URL and SESSION_SECRET at minimum
npm run db:migrate
SEED_ADMIN_EMAIL=you@example.com npm run db:seed      # first administrator (a one-time password is printed)
npm run dev                     # http://localhost:3000
npm run worker                  # in a second terminal, for AI drafts, email and scans
```

Demo data with one user per role (password `Demo-Passw0rd-2026`, refused in production):
`NODE_ENV=development SEED_DEMO=1 npm run db:seed`, then sign in as `admin@demo.samakose.test`, `consultant@demo.samakose.test`, `reviewer@demo.samakose.test`, `owner@demo.samakose.test` and so on (also exec, pm, coach, finance, funder).

## With Docker

```bash
cp .env.example .env            # set POSTGRES_PASSWORD, SESSION_SECRET, CRON_SECRET, APP_URL
docker compose up --build       # db, migrations, web on :3000, worker
```

## Safe defaults

With no keys set: `AI_MODE=mock` (deterministic drafts, clearly marked), Paystack uses a labelled test checkout, email is logged, Kobo intake is off. Set `AI_MODE=claude` with `CLAUDE_API_KEY`, `PAYSTACK_SECRET_KEY`, `SMTP_*` and `KOBO_*` for live use, then check `/admin/system`.

## Commands

| Command | Purpose |
|---|---|
| `npm test` | 223 tests on a real Postgres (`DATABASE_URL` must point at a server you can drop a `samakose_test` database on) |
| `npm run typecheck` | strict TypeScript |
| `npm run openapi` | regenerate `docs/openapi.json` |
| `npm run test:e2e` | browser journeys against `E2E_BASE` (default `http://localhost:3100`) seeded with demo data |

Read `docs/ARCHITECTURE.md` first, then `docs/SCREEN-MAP.csv` for how the 217 design boards map to what is built.

## Interface design notes

The front end follows the UI UX Pro Max guidance (data-dense dashboard direction): self-hosted Fira Sans and Fira Code, Lucide SVG icons, 150ms motion with reduced-motion support, 44px touch targets on touch devices, a bottom tab bar on phones, a light/dark/system theme toggle, badge icons so status never relies on colour alone, and a `/` shortcut to focus search.

## Deploying on Supabase

Supabase is used as a plain Postgres host only. The app keeps its own login, MFA and role checks.

1. Create a project. Copy the Direct (or Session pooler, port 5432) and Transaction pooler (port 6543) connection strings.
2. Migrate and seed with the direct string: `DATABASE_URL=<direct> npm run db:migrate`, then `SEED_ADMIN_EMAIL=you@example.com DATABASE_URL=<direct> npm run db:seed`.
3. Run the app with `DATABASE_URL=<transaction pooler>` and `DB_POOL_MAX=5`.
4. Migration `0004_lock_data_api.sql` enables Row Level Security on every table and revokes the `anon` and `authenticated` roles, so Supabase's auto-generated REST API cannot read your data. It is harmless on other Postgres hosts.
5. Enable backups (paid plan for point-in-time recovery) and test a restore before go-live.
