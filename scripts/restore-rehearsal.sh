#!/bin/sh
# Backup and restore rehearsal. Dumps SOURCE_DB, restores it into a fresh database, then compares row counts,
# constraints, triggers, indexes and row-level-security flags. Exits non-zero on any difference.
# Usage: PGHOST=localhost PGPORT=5433 PGUSER=postgres sh scripts/restore-rehearsal.sh [source_db]
set -e
SRC="${1:-samakose_dev}"; DST="${SRC}_restore"; DUMP="${TMPDIR:-/tmp}/restore-rehearsal.dump"
psql -qc "drop database if exists $DST" -c "create database $DST"
pg_dump -Fc -d "$SRC" -f "$DUMP"
pg_restore -d "$DST" --no-owner --exit-on-error "$DUMP"
counts() { psql -At -d "$1" -c "select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE' order by 1" | while read t; do echo "$t $(psql -At -d "$1" -c "select count(*) from \"$t\"")"; done; }
shape() { psql -At -d "$1" -c "select (select count(*) from pg_constraint c join pg_namespace n on n.oid=c.connamespace where n.nspname='public'), (select count(*) from pg_trigger where not tgisinternal), (select count(*) from pg_indexes where schemaname='public'), (select count(*) from pg_class where relkind='r' and relnamespace='public'::regnamespace and relrowsecurity)"; }
[ "$(counts "$SRC")" = "$(counts "$DST")" ] || { echo "FAIL: row counts differ"; exit 1; }
[ "$(shape "$SRC")" = "$(shape "$DST")" ] || { echo "FAIL: constraints, triggers, indexes or RLS differ"; exit 1; }
echo "Restore rehearsal passed: $(counts "$DST" | wc -l) tables, $(counts "$DST" | awk '{s+=$2} END {print s}') rows, shape identical."
psql -qc "drop database $DST"
