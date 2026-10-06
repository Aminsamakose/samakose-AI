# Business Doctor by Samakose

The Business Doctor platform, by Samakose. Formerly named Samakose AI Business Health OS.

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
| `npm test` | The full test suite (about 800 tests) on a real Postgres (`DATABASE_URL` must point at a server you can drop a `samakose_test` database on) |
| `npm run typecheck` | strict TypeScript |
| `npm run openapi` | regenerate `docs/openapi.json` |
| `npm run test:e2e` | browser journeys against `E2E_BASE` (default `http://localhost:3100`) seeded with demo data |

Read `docs/ARCHITECTURE.md` first, then `docs/SCREEN-MAP.csv` for how the 217 design boards map to what is built.

## Deploying on Vercel

Vercel's disk is temporary and its functions are short-lived, so three things differ from a container host.

1. **File storage.** Easiest: in Vercel open the Storage tab, create a **Blob** store (private) and connect it to the project. Vercel adds `BLOB_READ_WRITE_TOKEN` and the app switches to it automatically, with no keys to handle. Alternatively set `STORAGE_DRIVER=s3` plus `S3_BUCKET`, `S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY`. Any S3-compatible bucket works: Supabase Storage (create a private bucket, then use the S3 connection details in Storage settings), Cloudflare R2 or AWS S3. Keep the bucket private. Files still go through the API, so access checks and integrity hashes apply.
2. **Upload size.** Vercel rejects request bodies over 4.5 MB, so the default limit is 4 MB there. Larger files need a direct-to-bucket upload flow, which is not built.
3. **Background jobs.** Jobs started by a request keep the function alive until they finish (up to 60 seconds). `vercel.json` also calls `/api/internal/cron` once a day, which suits the Hobby plan. On Pro, change the schedule to `*/5 * * * *` so retries, overdue scans and emails run promptly. Set `CRON_SECRET`; Vercel sends it as a bearer token.

Also set `DATABASE_URL` (pooler), `DB_POOL_MAX=5`, `APP_URL`, `SESSION_SECRET`, `NODE_ENV=production`, `TRUST_PROXY=1` and the AI, Paystack and email variables. Run migrations from your machine or CI before the first deploy (`npm run db:migrate`); the build does not run them.


### Programme Operating System progress
Monitoring and provider performance is governed as a measurement layer over Programme Workspace delivery, assignments, attendance and coordination records.
