import { beforeAll, describe, expect, it } from 'vitest';
import { api, ensureReference, makeUser, type Session } from './helpers';

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
