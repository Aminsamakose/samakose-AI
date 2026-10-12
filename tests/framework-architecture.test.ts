import { describe, expect, it } from 'vitest';

describe('normalized Business Doctor framework architecture', () => {
  it('defines the required governed component tables in the migration', async () => {
    const fs = await import('node:fs/promises');
    const sql = await fs.readFile('migrations/0048_framework_architecture.sql', 'utf8');

    for (const table of [
      'framework_dimensions',
      'framework_sub_dimensions',
      'framework_questions',
      'framework_evidence_requirements',
      'framework_scoring_rules',
      'framework_readiness_rules',
      'framework_source_records',
    ]) {
      expect(sql).toContain(`create table if not exists public.${table}`);
      expect(sql).toContain(`alter table public.${table} enable row level security`);
    }
  });

  it('enforces immutable published framework children at database level', async () => {
    const fs = await import('node:fs/promises');
    const sql = await fs.readFile('migrations/0048_framework_architecture.sql', 'utf8');

    expect(sql).toContain('framework_version_is_published');
    expect(sql).toContain('reject_published_framework_change');
    expect(sql).toContain('Published framework content is immutable; create a new framework version.');
    expect(sql).toContain("v.status in ('Published', 'Retired')");
    for (const table of [
      'framework_dimensions', 'framework_sub_dimensions', 'framework_questions',
      'framework_evidence_requirements', 'framework_scoring_rules',
      'framework_readiness_rules', 'framework_source_records'
    ]) {
      const trigger = table.replace('framework_evidence_requirements', 'framework_evidence').replace('framework_source_records', 'framework_sources');
      expect(sql).toContain(`create trigger ${trigger}_immutable before insert or update or delete on public.${table}`);
    }
    expect(sql).toContain("tg_table_name = 'framework_sub_dimensions'");
    expect(sql).toContain("tg_table_name = 'framework_evidence_requirements'");
  });

  it('preserves the existing versioned JSON model for backward compatibility', async () => {
    const fs = await import('node:fs/promises');
    const sql = await fs.readFile('migrations/0011_framework_versions.sql', 'utf8');

    expect(sql).toContain('CREATE TABLE "framework_versions"');
    expect(sql).toContain('"questions" jsonb NOT NULL');
    expect(sql).toContain('"dimensions" jsonb NOT NULL');
  });

  it('backfills legacy snapshots before it freezes normalized framework content', async () => {
    const fs = await import('node:fs/promises');
    const sql = await fs.readFile('migrations/0048_framework_architecture.sql', 'utf8');

    expect(sql).toContain('Backfill normalized records from legacy snapshots');
    expect(sql).toContain('insert into public.framework_dimensions');
    expect(sql).toContain('insert into public.framework_questions');
    expect(sql).toContain('insert into public.framework_evidence_requirements');
    expect(sql).toContain('insert into public.framework_readiness_rules');
    expect(sql.indexOf('insert into public.framework_questions')).toBeLessThan(sql.indexOf('create trigger framework_questions_immutable'));
  });
});
