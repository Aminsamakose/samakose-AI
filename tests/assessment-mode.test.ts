import { describe, expect, it } from 'vitest';
import { modeOf } from '@/services/diagnostics';
import { pool } from '@/db/client';

describe('assessment mode is derived from who answered', () => {
  it('self when only the submitter answered, hybrid when others helped, team when only others answered', () => {
    expect(modeOf('web', 'OWNER', 'u1', ['u1', 'u1'])).toBe('self');
    expect(modeOf('web', 'OWNER', 'u1', [null, 'u1'])).toBe('self');
    expect(modeOf('web', 'OWNER', 'u1', ['u1', 'u2'])).toBe('hybrid');
    expect(modeOf('web', 'OWNER', 'u1', ['u2', 'u3'])).toBe('team');
  });
  it('consultant when an expert submits, imported when it came from a field tool', () => {
    expect(modeOf('web', 'EXPERT', 'e1', ['e1'])).toBe('consultant');
    expect(modeOf('kobo', undefined, undefined, [null])).toBe('imported');
  });
  it('the database refuses a value outside the list', async () => {
    await expect(pool().query(`select 1 where 'solo' in ('self','hybrid','team','consultant','imported')`)).resolves.toBeTruthy();
    const r = await pool().query(`select pg_get_constraintdef(oid) d from pg_constraint where conname='diag_mode_valid'`);
    expect(r.rows[0].d).toContain("'consultant'");
  });
});
