import { beforeAll, describe, expect, it } from 'vitest';
import { api, call, ensureReference, lastEmailTo, makeUser, PASSWORD, tokenFrom, uniq, type Session } from './helpers';
import { db, schema } from '@/db/client';
import { eq } from 'drizzle-orm';
import { TEMPLATES, render, templateProblems } from '@/domain/email-templates';

let admin: Session, coach: Session;
beforeAll(async () => { await ensureReference(); admin = await makeUser('ADMIN'); coach = await makeUser('COACH'); });
const reg = (o: Record<string, unknown> = {}) => ({ name: 'Ama Mensah', email: `ama.${uniq()}@example.org`, password: PASSWORD, role: 'OWNER', orgName: 'Mensah Foods', orgType: 'SME', consent: true, ...o });
const sw = (key: string, on: boolean, reason?: string) => api(admin).put(`/settings/switches/${key}`, { on, reason });

describe('switches', () => {
  it('only an administrator can read or change them', async () => {
    expect((await api(coach).get('/settings/switches')).status).toBe(403);
    expect((await api(coach).put('/settings/switches/switch.self_registration', { on: false })).status).toBe(403);
    expect((await api(admin).get('/settings/switches')).data.length).toBeGreaterThan(5);
    expect((await sw('switch.nope', false)).status).toBe(400);
  });
  it('closes self-registration and reopens it', async () => {
    expect((await sw('switch.self_registration', false)).status).toBe(200);
    expect((await call('POST', '/auth/register', { body: reg() })).status).toBe(403);
    expect((await call('GET', '/auth/providers')).data.selfRegistration).toBe(false);
    expect((await sw('switch.self_registration', true)).status).toBe(200);
    expect((await call('POST', '/auth/register', { body: reg() })).status).toBe(200);
  });
  it('can close one role without closing the others', async () => {
    expect((await sw('switch.role.FUNDER', false)).status).toBe(200);
    expect((await call('POST', '/auth/register', { body: reg({ role: 'FUNDER', orgName: 'Funder Co' }) })).status).toBe(400);
    expect((await call('GET', '/auth/providers')).data.roles).not.toContain('FUNDER');
    expect((await call('POST', '/auth/register', { body: reg({ role: 'COACH', orgName: 'Coach Co' }) })).status).toBe(200);
    await sw('switch.role.FUNDER', true);
  });
  it('can require approval for new owners', async () => {
    await sw('switch.owner_needs_approval', true);
    const b = reg(); await call('POST', '/auth/register', { body: b });
    const r = await call('POST', '/auth/verify-email', { body: { token: tokenFrom((await lastEmailTo(b.email)).body) } });
    expect(r.data.next).toBe('pending');
    await sw('switch.owner_needs_approval', false);
  });
});

describe('email templates', () => {
  it('render fills variables and unknown ones are rejected', () => {
    expect(render('Hi {{user_name}}, {{ link }}', { user_name: 'Ama', link: 'x' })).toBe('Hi Ama, x');
    const t = TEMPLATES[0];
    expect(Object.keys(templateProblems(t, 'Subject', 'No link here'))).toContain('body');
    expect(templateProblems(t, 'Subject', 'Hi {{user_name}} {{secret}} {{link}}').body).toMatch(/Unknown variable/);
    expect(templateProblems(t, 'Subject', 'Hi {{user_name}} {{link}}')).toEqual({});
    expect(templateProblems(t, 'Line\nbreak', 'x {{link}}').subject).toBeTruthy();
  });
  it('an edited template is used for the next email, and reset restores the built-in text', async () => {
    expect((await api(coach).put('/settings/email-templates/verify_email', { subject: 'x', body: '{{link}}' })).status).toBe(403);
    expect((await api(admin).put('/settings/email-templates/verify_email', { subject: 'Welcome', body: 'Nothing' })).status).toBe(400);
    expect((await api(admin).put('/settings/email-templates/verify_email', { subject: 'Welcome to the Business Doctor', body: 'Dear {{user_name}}, confirm here: {{link}}' })).status).toBe(200);
    const b = reg(); await call('POST', '/auth/register', { body: b });
    const m = await lastEmailTo(b.email);
    expect(m.subject).toBe('Welcome to the Business Doctor'); expect(m.body).toContain('Dear Ama Mensah'); expect(tokenFrom(m.body)).toBeTruthy();
    expect((await api(admin).post('/settings/email-templates/verify_email/reset', {})).status).toBe(200);
    const b2 = reg(); await call('POST', '/auth/register', { body: b2 });
    expect((await lastEmailTo(b2.email)).subject).toBe('Confirm your email for Samakose');
    expect((await db().select().from(schema.emailTemplates).where(eq(schema.emailTemplates.key, 'verify_email'))).length).toBe(0);
  });
});

describe('report wording', () => {
  it('validates and saves', async () => {
    expect((await api(admin).put('/settings/report-text', { values: { 'text.report_title': 'Hi {{secret}}' } })).status).toBe(400);
    expect((await api(admin).put('/settings/report-text', { values: { 'text.report_title': 'Business health review: {{organisation}}', 'text.report_closing': 'Based on self-reported data.' } })).status).toBe(200);
    const d = (await api(admin).get('/settings/report-text')).data;
    expect(d.find((x: any) => x.key === 'text.report_closing').value).toBe('Based on self-reported data.');
    await api(admin).put('/settings/report-text', { values: { 'text.report_title': 'Progress report for {{organisation}}', 'text.report_closing': '' } });
  });
});
