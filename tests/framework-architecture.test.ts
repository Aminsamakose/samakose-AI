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
  });

  it('preserves the existing versioned JSON model for backward compatibility', async () => {
    const fs = await import('node:fs/promises');
    const sql = await fs.readFile('migrations/0011_framework_versions.sql', 'utf8');

    expect(sql).toContain('CREATE TABLE "framework_versions"');
    expect(sql).toContain('"questions" jsonb NOT NULL');
    expect(sql).toContain('"dimensions" jsonb NOT NULL');
  });
});
