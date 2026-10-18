import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { api, ensureReference, makeUser, type Session } from './helpers';
import { db, schema } from '@/db/client';
import { inArray } from 'drizzle-orm';

let admin: Session, pm: Session;

beforeAll(async () => {
  await ensureReference();
  admin = await makeUser('ADMIN');
  pm = await makeUser('PROGRAMME_MANAGER');
});

describe('third-party integration settings (Zoom, Teams, WhatsApp, SMS, e-signature, accounting)', () => {
  it('is admin-only: a non-admin role cannot read or change integration settings', async () => {
    expect((await api(pm).get('/settings/integrations')).status).toBe(403);
    expect((await api(pm).put('/settings/integrations/sms', { provider: 'twilio' })).status).toBe(403);
    expect((await api(pm).post('/settings/integrations/sms/test', {})).status).toBe(403);
  });

  it('lists all eight integrations with no credentials leaked, only presence booleans', async () => {
    const list = await api(admin).get('/settings/integrations');
    expect(list.status).toBe(200);
    const ids = list.data.map((x: any) => x.id).sort();
    expect(ids).toEqual(['accounting', 'esignature', 'google_meet', 'sms', 'teams', 'video', 'whatsapp', 'zoom'].sort());
    for (const row of list.data) {
      for (const v of row.envVars) {
        expect(typeof v.set).toBe('boolean');
        expect(v).not.toHaveProperty('value');
      }
    }
    // None of these have credentials in this test environment, so none should report configured.
    expect(list.data.every((x: any) => x.configured === false)).toBe(true);
  });

  it('reports every integration as not configured and the test endpoint says so clearly, without crashing', async () => {
    for (const id of ['zoom', 'teams', 'whatsapp', 'esignature', 'google_meet']) {
      const r = await api(admin).post(`/settings/integrations/${id}/test`, {});
      expect(r.status).toBe(200);
      expect(r.data.ok).toBe(false);
      expect(r.data.message.toLowerCase()).toContain('not configured');
    }
  });

  it('refuses to test the default video provider before one is chosen, without crashing', async () => {
    const r = await api(admin).post('/settings/integrations/video/test', {});
    expect(r.status).toBe(200);
    expect(r.data.ok).toBe(false);
    expect(r.data.message.toLowerCase()).toContain('choose a default video provider');
  });

  it('saves a valid default video provider choice, independent of SMS/accounting', async () => {
    const save = await api(admin).put('/settings/integrations/video', { provider: 'zoom' });
    expect(save.status).toBe(200);
    expect(save.data.find((x: any) => x.id === 'video').providerChoice).toBe('zoom');
    const test = await api(admin).post('/settings/integrations/video/test', {});
    expect(test.status).toBe(200);
    expect(test.data.ok).toBe(false);
    expect(test.data.message.toLowerCase()).toContain('not configured');
  });

  it('rejects an unknown provider choice for SMS', async () => {
    const r = await api(admin).put('/settings/integrations/sms', { provider: 'carrier-pigeon' });
    expect(r.status).toBe(400);
    expect(r.error?.fields ?? r.error?.details).toBeTruthy();
  });

  it('saves a valid SMS provider choice, persists it, and the test endpoint reflects the choice', async () => {
    const save = await api(admin).put('/settings/integrations/sms', { provider: 'twilio' });
    expect(save.status).toBe(200);
    const row = save.data.find((x: any) => x.id === 'sms');
    expect(row.providerChoice).toBe('twilio');

    const reread = await api(admin).get('/settings/integrations');
    expect(reread.data.find((x: any) => x.id === 'sms').providerChoice).toBe('twilio');

    const test = await api(admin).post('/settings/integrations/sms/test', {});
    expect(test.status).toBe(200);
    expect(test.data.ok).toBe(false);
    expect(test.data.message.toLowerCase()).toContain('twilio');
  });

  it('saves a valid accounting provider choice independently of the SMS choice', async () => {
    const save = await api(admin).put('/settings/integrations/accounting', { provider: 'xero' });
    expect(save.status).toBe(200);
    expect(save.data.find((x: any) => x.id === 'accounting').providerChoice).toBe('xero');
    expect(save.data.find((x: any) => x.id === 'sms').providerChoice).toBe('twilio');
  });

  it('refuses a provider choice for an integration that has none', async () => {
    const r = await api(admin).put('/settings/integrations/zoom', { provider: 'twilio' });
    expect(r.status).toBe(400);
  });

  it('rejects an unknown integration key', async () => {
    const r = await api(admin).post('/settings/integrations/carrier-pigeon/test', {});
    expect(r.status).toBe(400);
  });
});

describe('admin-settable Zoom/Google Meet credentials (database-stored, encrypted)', () => {
  afterEach(async () => {
    await db().delete(schema.integrationCredentials).where(inArray(schema.integrationCredentials.integration, ['zoom', 'google_meet']));
  });

  it('is admin-only: a non-admin role cannot read or set credential fields', async () => {
    expect((await api(pm).get('/settings/integrations/zoom/credentials')).status).toBe(403);
    expect((await api(pm).put('/settings/integrations/zoom/credentials', { values: { accountId: 'x' } })).status).toBe(403);
  });

  it('refuses credential fields for an integration that has none (e.g. teams, which stays env-var-only)', async () => {
    expect((await api(admin).get('/settings/integrations/teams/credentials')).status).toBe(400);
    expect((await api(admin).put('/settings/integrations/teams/credentials', { values: { clientSecret: 'x' } })).status).toBe(400);
  });

  it('lists Zoom\'s three fields as unset, then reflects a saved value as sourced from the database', async () => {
    const before = await api(admin).get('/settings/integrations/zoom/credentials');
    expect(before.status).toBe(200);
    expect(before.data.map((f: any) => f.key).sort()).toEqual(['accountId', 'clientId', 'clientSecret']);
    expect(before.data.every((f: any) => f.source === 'none')).toBe(true);

    const save = await api(admin).put('/settings/integrations/zoom/credentials', { values: { accountId: 'acc-123', clientId: 'cid-123', clientSecret: 'super-secret' } });
    expect(save.status, JSON.stringify(save.error)).toBe(200);
    expect(save.data.every((f: any) => f.source === 'database')).toBe(true);
    // The value itself is never echoed back.
    for (const f of save.data) expect(f).not.toHaveProperty('value');

    const now = await api(admin).get('/settings/integrations');
    expect(now.data.find((x: any) => x.id === 'zoom').configured).toBe(true);
  });

  it('rejects an unknown field key for a credentialed integration', async () => {
    const r = await api(admin).put('/settings/integrations/zoom/credentials', { values: { notARealField: 'x' } });
    expect(r.status).toBe(400);
  });

  it('a database value takes precedence over the matching environment variable', async () => {
    const saved = process.env.ZOOM_ACCOUNT_ID;
    try {
      process.env.ZOOM_ACCOUNT_ID = 'env-account';
      await api(admin).put('/settings/integrations/zoom/credentials', { values: { accountId: 'db-account', clientId: 'db-client', clientSecret: 'db-secret' } });
      const fields = await api(admin).get('/settings/integrations/zoom/credentials');
      expect(fields.data.find((f: any) => f.key === 'accountId').source).toBe('database');
    } finally {
      if (saved === undefined) delete process.env.ZOOM_ACCOUNT_ID; else process.env.ZOOM_ACCOUNT_ID = saved;
    }
  });

  it('clearing a field (saving an empty value) reverts to its environment-variable fallback', async () => {
    const saved = process.env.ZOOM_ACCOUNT_ID;
    try {
      process.env.ZOOM_ACCOUNT_ID = 'env-account';
      await api(admin).put('/settings/integrations/zoom/credentials', { values: { accountId: 'db-account' } });
      let fields = await api(admin).get('/settings/integrations/zoom/credentials');
      expect(fields.data.find((f: any) => f.key === 'accountId').source).toBe('database');

      await api(admin).put('/settings/integrations/zoom/credentials', { values: { accountId: '' } });
      fields = await api(admin).get('/settings/integrations/zoom/credentials');
      expect(fields.data.find((f: any) => f.key === 'accountId').source).toBe('environment');
    } finally {
      if (saved === undefined) delete process.env.ZOOM_ACCOUNT_ID; else process.env.ZOOM_ACCOUNT_ID = saved;
    }
  });

  it('saving partial Zoom credentials is not reported as configured until all three fields are present', async () => {
    await api(admin).put('/settings/integrations/zoom/credentials', { values: { accountId: 'acc-only' } });
    const row = (await api(admin).get('/settings/integrations')).data.find((x: any) => x.id === 'zoom');
    expect(row.configured).toBe(false);
  });

  it('Google Meet lists its four fields and a saved refresh token is never echoed back', async () => {
    const fields = await api(admin).get('/settings/integrations/google_meet/credentials');
    expect(fields.status).toBe(200);
    expect(fields.data.map((f: any) => f.key).sort()).toEqual(['calendarId', 'clientId', 'clientSecret', 'refreshToken']);

    const save = await api(admin).put('/settings/integrations/google_meet/credentials', { values: { clientId: 'g-cid', clientSecret: 'g-secret', refreshToken: 'g-refresh' } });
    expect(save.status, JSON.stringify(save.error)).toBe(200);
    for (const f of save.data) { expect(f).not.toHaveProperty('value'); expect(JSON.stringify(f)).not.toContain('g-refresh'); }
    expect(save.data.find((f: any) => f.key === 'refreshToken').source).toBe('database');
    // calendarId was never set, so it falls back to "none" (no GOOGLE_CALENDAR_ID env var in this test environment).
    expect(save.data.find((f: any) => f.key === 'calendarId').source).toBe('none');

    const now = await api(admin).get('/settings/integrations');
    expect(now.data.find((x: any) => x.id === 'google_meet').configured).toBe(true);
  });
});
