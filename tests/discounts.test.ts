import { beforeAll, describe, expect, it } from 'vitest';
import { api, ensureReference, makeOrg, makeUser, uniq, type Session } from './helpers';

let finance: Session, admin: Session, executive: Session, owner: Session, orgId: string;
beforeAll(async () => {
  await ensureReference();
  admin = await makeUser('ADMIN'); finance = await makeUser('FINANCE'); executive = await makeUser('EXECUTIVE');
  const o = await makeOrg(admin); orgId = o.id; owner = await makeUser('OWNER', { orgId });
});

async function approvedPercentCampaign(value = 10) {
  const rule = (await api(finance).post('/discount-rules', { kind: 'PERCENTAGE', value })).data;
  expect((await api(finance).post(`/discount-rules/${rule.id}/approve`, {})).status).toBe(403); // finance may not approve at all
  expect((await api(executive).post(`/discount-rules/${rule.id}/approve`, {})).status).toBe(200);
  const campaign = (await api(finance).post('/promo-campaigns', { name: `Campaign ${uniq()}`, discountRuleId: rule.id })).data;
  const code = (await api(finance).post('/promo-codes', { campaignId: campaign.id, prefix: 'TEST' })).data;
  return { rule, campaign, code };
}

describe('discounts & promo codes', () => {
  it('requires a second person to approve a discount rule (four-eyes)', async () => {
    const rule = (await api(finance).post('/discount-rules', { kind: 'FIXED', value: 50 })).data;
    expect((await api(admin).post(`/discount-rules/${rule.id}/approve`, {})).status).toBe(200);
    // Same rule cannot be approved twice.
    expect((await api(executive).post(`/discount-rules/${rule.id}/approve`, {})).status).toBe(409);
  });

  it('refuses self-approval even for a role that can both create and approve', async () => {
    const rule = (await api(admin).post('/discount-rules', { kind: 'FIXED', value: 20 })).data;
    expect((await api(admin).post(`/discount-rules/${rule.id}/approve`, {})).status).toBe(403);
    expect((await api(executive).post(`/discount-rules/${rule.id}/approve`, {})).status).toBe(200);
  });

  it('applies a percentage discount to a draft invoice and reduces its amount', async () => {
    const { code } = await approvedPercentCampaign(10);
    const inv = (await api(finance).post('/invoices', { orgId, amountGhs: 1000, dueDate: '2099-01-01' })).data;
    const r = await api(finance).post(`/invoices/${inv.id}/apply-promo`, { code: code.code, customerId: owner.userId });
    expect(r.status).toBe(200);
    expect(r.data.discountGhs).toBe('100.00');
    expect((await api(finance).get(`/invoices/${inv.id}`)).data.amountGhs).toBe('900.00');
  });

  it('cannot be redeemed twice by the same customer, and not once the invoice is Sent', async () => {
    const { code } = await approvedPercentCampaign(10);
    const inv = (await api(finance).post('/invoices', { orgId, amountGhs: 500, dueDate: '2099-01-01' })).data;
    const cust = owner.userId;
    expect((await api(finance).post(`/invoices/${inv.id}/apply-promo`, { code: code.code, customerId: cust })).status).toBe(200);

    const inv2 = (await api(finance).post('/invoices', { orgId, amountGhs: 500, dueDate: '2099-01-01' })).data;
    expect((await api(finance).post(`/invoices/${inv2.id}/apply-promo`, { code: code.code, customerId: cust })).status).toBe(409);

    const inv3 = (await api(finance).post('/invoices', { orgId, amountGhs: 500, dueDate: '2099-01-01' })).data;
    await api(finance).patch(`/invoices/${inv3.id}`, { status: 'Sent' });
    const { code: code2 } = await approvedPercentCampaign(10);
    expect((await api(finance).post(`/invoices/${inv3.id}/apply-promo`, { code: code2.code, customerId: cust })).status).toBe(422);
  });

  it('rejects a promo code built on an unapproved discount rule', async () => {
    const rule = (await api(finance).post('/discount-rules', { kind: 'FIXED', value: 10 })).data;
    const campaign = (await api(finance).post('/promo-campaigns', { name: `Campaign ${uniq()}`, discountRuleId: rule.id })).data;
    const code = (await api(finance).post('/promo-codes', { campaignId: campaign.id })).data;
    const inv = (await api(finance).post('/invoices', { orgId, amountGhs: 100, dueDate: '2099-01-01' })).data;
    expect((await api(finance).post(`/invoices/${inv.id}/apply-promo`, { code: code.code, customerId: owner.userId })).status).toBe(400);
  });

  it('honours a maximum-discount cap and a minimum-purchase floor', async () => {
    const rule = (await api(finance).post('/discount-rules', { kind: 'PERCENTAGE', value: 50 })).data;
    await api(executive).post(`/discount-rules/${rule.id}/approve`, {});
    const campaign = (await api(finance).post('/promo-campaigns', { name: `Campaign ${uniq()}`, discountRuleId: rule.id })).data;
    const code = (await api(finance).post('/promo-codes', { campaignId: campaign.id, maxDiscountGhs: 30, minPurchaseGhs: 200 })).data;

    const cheap = (await api(finance).post('/invoices', { orgId, amountGhs: 100, dueDate: '2099-01-01' })).data;
    expect((await api(finance).post(`/invoices/${cheap.id}/apply-promo`, { code: code.code, customerId: owner.userId })).status).toBe(400);

    const big = (await api(finance).post('/invoices', { orgId, amountGhs: 1000, dueDate: '2099-01-01' })).data;
    const r = await api(finance).post(`/invoices/${big.id}/apply-promo`, { code: code.code, customerId: owner.userId });
    expect(r.status).toBe(200);
    expect(r.data.discountGhs).toBe('30.00'); // 50% of 1000 would be 500, capped to 30
  });

  it('refuses a customer who is not the owner of the invoice organisation', async () => {
    const { code } = await approvedPercentCampaign(10);
    const inv = (await api(finance).post('/invoices', { orgId, amountGhs: 100, dueDate: '2099-01-01' })).data;
    expect((await api(finance).post(`/invoices/${inv.id}/apply-promo`, { code: code.code, customerId: finance.userId })).status).toBe(400);
  });
});
