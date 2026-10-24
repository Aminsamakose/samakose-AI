import { beforeAll, describe, expect, it } from 'vitest';
import { api, ensureReference, makeOrg, makeUser, type Session } from './helpers';

let admin: Session, fin: Session, executive: Session, expert: Session, orgId: string;
const mk = async (extra: Record<string, unknown> = {}, activate = true) => {
  const id = (await api(fin).post('/contracts', { orgId, startDate: '2027-01-01', endDate: '2027-12-31', amountGhs: 5000, ...extra })).data.id as string;
  if (activate) expect((await api(fin).patch(`/contracts/${id}`, { status: 'Active' })).status).toBe(200);
  return id;
};
beforeAll(async () => {
  await ensureReference();
  admin = await makeUser('ADMIN'); fin = await makeUser('FINANCE'); executive = await makeUser('EXECUTIVE'); expert = await makeUser('EXPERT');
  orgId = (await makeOrg(admin)).id;
});

describe('contract template versioning', () => {
  it('starts at version 1, Draft; publishing retires the previous Published version of the same name', async () => {
    const v1 = (await api(fin).post('/contract-templates', { name: 'Standard SME Agreement', bodyMarkdown: '# v1 {{contract.code}}' })).data;
    expect(v1.version).toBe(1); expect(v1.status).toBe('Draft');
    expect((await api(fin).post(`/contract-templates/${v1.id}/publish`, {})).status).toBe(200);

    const v2 = (await api(fin).post(`/contract-templates/${v1.id}/new-version`, { bodyMarkdown: '# v2 {{contract.code}}' })).data;
    expect(v2.version).toBe(2); expect(v2.name).toBe('Standard SME Agreement');

    const publish2 = await api(fin).post(`/contract-templates/${v2.id}/publish`, {});
    expect(publish2.status, JSON.stringify(publish2.error)).toBe(200);

    const list = (await api(fin).get('/contract-templates?name=Standard SME Agreement')).data as any[];
    const refreshedV1 = list.find((t) => t.id === v1.id);
    expect(refreshedV1.status).toBe('Retired');
    expect(list.find((t) => t.id === v2.id).status).toBe('Published');
  });

  it('cannot edit a non-Draft version, cannot publish a non-Draft, cannot double-retire', async () => {
    const t = (await api(fin).post('/contract-templates', { name: `Edit test ${Date.now()}`, bodyMarkdown: '# body text long enough' })).data;
    await api(fin).post(`/contract-templates/${t.id}/publish`, {});
    expect((await api(fin).patch(`/contract-templates/${t.id}`, { bodyMarkdown: '# changed body, still long enough' })).status).toBe(422);
    expect((await api(fin).post(`/contract-templates/${t.id}/publish`, {})).status).toBe(422);
    expect((await api(fin).post(`/contract-templates/${t.id}/retire`, {})).status).toBe(200);
    expect((await api(fin).post(`/contract-templates/${t.id}/retire`, {})).status).toBe(409);
  });

  it('EXPERT has no access to templates', async () => {
    expect((await api(expert).get('/contract-templates')).status).toBe(403);
    expect((await api(expert).post('/contract-templates', { name: 'x', bodyMarkdown: 'y' })).status).toBe(403);
  });
});

describe('distinct contracting parties', () => {
  it('CLIENT and SAMAKOSE are singular per contract; GUARANTOR/WITNESS may repeat', async () => {
    const contractId = await mk();
    const client = await api(fin).post(`/contracts/${contractId}/parties`, { role: 'CLIENT', partyType: 'ORGANISATION', orgId, name: 'Bagabaga Shea Cooperative' });
    expect(client.status, JSON.stringify(client.error)).toBe(201);
    const dupeClient = await api(fin).post(`/contracts/${contractId}/parties`, { role: 'CLIENT', partyType: 'ORGANISATION', orgId, name: 'Someone else' });
    expect(dupeClient.status).toBe(409);

    const samakose = await api(fin).post(`/contracts/${contractId}/parties`, { role: 'SAMAKOSE', partyType: 'ORGANISATION', name: 'Samakose Accelerator Lab' });
    expect(samakose.status).toBe(201);

    const w1 = await api(fin).post(`/contracts/${contractId}/parties`, { role: 'WITNESS', partyType: 'INDIVIDUAL', name: 'Witness One' });
    const w2 = await api(fin).post(`/contracts/${contractId}/parties`, { role: 'WITNESS', partyType: 'INDIVIDUAL', name: 'Witness Two' });
    expect(w1.status).toBe(201); expect(w2.status).toBe(201);

    const parties = (await api(executive).get(`/contracts/${contractId}/parties`)).data as any[];
    expect(parties.length).toBe(4);
    expect(parties.filter((p) => p.role === 'WITNESS').length).toBe(2);
  });

  it('rejects an unknown role, and removing a party frees its slot for a singular role', async () => {
    const contractId = await mk();
    expect((await api(fin).post(`/contracts/${contractId}/parties`, { role: 'NOTARY', partyType: 'INDIVIDUAL', name: 'X' })).status).toBe(400);
    const client = (await api(fin).post(`/contracts/${contractId}/parties`, { role: 'CLIENT', partyType: 'ORGANISATION', orgId, name: 'First client' })).data;
    expect((await api(fin).del(`/contracts/${contractId}/parties/${client.id}`)).status).toBe(200);
    const again = await api(fin).post(`/contracts/${contractId}/parties`, { role: 'CLIENT', partyType: 'ORGANISATION', orgId, name: 'Second client' });
    expect(again.status, JSON.stringify(again.error)).toBe(201);
  });

  it('a renamed party keeps its originally-recorded name (snapshot, not a live reference)', async () => {
    const contractId = await mk();
    const party = (await api(fin).post(`/contracts/${contractId}/parties`, { role: 'CLIENT', partyType: 'ORGANISATION', orgId, name: 'Original Name Ltd' })).data;
    await api(admin).patch(`/organisations/${orgId}`, { name: 'Renamed Ltd' });
    const parties = (await api(fin).get(`/contracts/${contractId}/parties`)).data as any[];
    expect(parties.find((p: any) => p.id === party.id).name).toBe('Original Name Ltd');
  });
});

describe('generated contract documents', () => {
  it('renders a template against the contract and its parties, and freezes an immutable, hashed snapshot', async () => {
    const contractId = await mk({ amountGhs: 7500 });
    await api(fin).post(`/contracts/${contractId}/parties`, { role: 'CLIENT', partyType: 'ORGANISATION', orgId, name: 'Client Co' });
    await api(fin).post(`/contracts/${contractId}/parties`, { role: 'SAMAKOSE', partyType: 'ORGANISATION', name: 'Samakose Accelerator Lab' });
    const template = (await api(fin).post('/contract-templates', {
      name: `Doc gen test ${Date.now()}`,
      bodyMarkdown: 'Agreement {{contract.code}} between {{party.SAMAKOSE.name}} and {{party.CLIENT.name}} for GHS {{contract.amountGhs}}.'
    })).data;
    await api(fin).post(`/contract-templates/${template.id}/publish`, {});

    const doc = await api(fin).post(`/contracts/${contractId}/documents`, { templateId: template.id, reason: 'Issued' });
    expect(doc.status, JSON.stringify(doc.error)).toBe(201);
    expect(doc.data.contentMarkdown).toContain('Client Co');
    expect(doc.data.contentMarkdown).toContain('Samakose Accelerator Lab');
    expect(doc.data.contentMarkdown).toContain('7500.00');
    expect(doc.data.templateVersion).toBe(1);
    expect(typeof doc.data.contentHash).toBe('string');
    expect(doc.data.contentHash.length).toBe(64); // sha256 hex
  });

  it('falls back to a minimal built-in layout when no template is given', async () => {
    const contractId = await mk();
    const doc = await api(fin).post(`/contracts/${contractId}/documents`, {});
    expect(doc.status, JSON.stringify(doc.error)).toBe(201);
    expect(doc.data.templateId).toBeNull();
  });

  it('refuses to generate from a Retired template version', async () => {
    const contractId = await mk();
    const t = (await api(fin).post('/contract-templates', { name: `Retired test ${Date.now()}`, bodyMarkdown: '# a retired template body' })).data;
    await api(fin).post(`/contract-templates/${t.id}/retire`, {});
    const doc = await api(fin).post(`/contracts/${contractId}/documents`, { templateId: t.id });
    expect(doc.status).toBe(422);
  });

  it('a later amendment does not change an already-generated document (append-only history)', async () => {
    const contractId = await mk({ amountGhs: 1000 });
    const doc1 = (await api(fin).post(`/contracts/${contractId}/documents`, { reason: 'Issued' })).data;
    await api(fin).post(`/contracts/${contractId}/amend`, { amountGhs: 2000, reason: 'Scope increased' });
    const refetched = (await api(fin).get(`/contracts/${contractId}/documents`)).data.find((d: any) => d.id === doc1.id);
    expect(refetched.contentHash).toBe(doc1.contentHash);
    const doc2 = (await api(fin).post(`/contracts/${contractId}/documents`, { reason: 'Amended' })).data;
    expect(doc2.contentHash).not.toBe(doc1.contentHash);
  });

  it('lists newest first', async () => {
    const contractId = await mk();
    const d1 = (await api(fin).post(`/contracts/${contractId}/documents`, {})).data;
    const d2 = (await api(fin).post(`/contracts/${contractId}/documents`, {})).data;
    const list = (await api(executive).get(`/contracts/${contractId}/documents`)).data as any[];
    expect(list[0].id).toBe(d2.id);
    expect(list.some((d: any) => d.id === d1.id)).toBe(true);
  });
});
