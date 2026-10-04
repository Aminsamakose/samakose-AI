# Backup and restore rehearsal, 4 October 2026

**Method.** `npm run db:restore-rehearse` dumps a database in custom format, restores it into a fresh database with `--exit-on-error`, then compares every table's row count and the number of constraints, triggers, indexes and tables with row-level security on.

**Result on the development database (all 32 migrations applied).** Passed. 72 tables and 6,466 rows restored with identical counts. 285 constraints, 20 triggers, 200 indexes and 72 row-level-security flags all matched. The append-only guard on the audit log still blocks updates in the restored copy.

**What this proves.** The schema, data and protections survive a dump and restore cycle, and the procedure is repeatable.

**What it does not prove.** It was run on a development copy, not on the production Supabase backups. Production recovery depends on Supabase's own backups and point-in-time recovery, which should be confirmed on the live plan and tested once by restoring a backup into a separate Supabase project before go-live. Restore time on production-sized data is unknown.
