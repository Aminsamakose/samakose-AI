import { beforeAll, describe, expect, it } from 'vitest';
import { api, ensureReference, makeUser, uniq, type Session } from './helpers';

let admin: Session;

beforeAll(async () => { await ensureReference(); admin = await makeUser('ADMIN'); });

/**
 * programme-finance.ts checks "would this exceed the programme budget?" and then inserts the
 * budget line / tranche as two separate statements. Like cohort capacity (see
 * cohort-capacity-race.test.ts), a plain transaction does not by itself stop two concurrent
 * requests from both reading the same pre-write sum, both passing the ceiling check, and both
 * committing -- only an explicit lockCapacityScope serializes the check against the write.
 * addLine/updateLine/addTranche/updateTranche now take that lock before summing, on
 * `budget-lines:${programmeId}` / `tranches:${programmeId}`.
 */
describe('programme budget (check-then-act race on budget lines and tranches)', () => {
  it('adding two budget lines that together exceed the budget, concurrently, only lets one through', async () => {
    const prog = (await api(admin).post('/programmes', { name: `Budget race ${uniq()}`, budgetGhs: 1000 })).data;
    const addLine = () => api(admin).post(`/programmes/${prog.id}/budget-lines`, { category: `cat-${uniq()}`, amountGhs: 700 });
    const [r1, r2] = await Promise.all([addLine(), addLine()]);
    const statuses = [r1.status, r2.status].sort();
    expect(statuses).toEqual([201, 400]);

    const overview = (await api(admin).get(`/programmes/${prog.id}/budget`)).data;
    expect(overview.lines.length).toBe(1);
    expect(overview.lines[0].amountGhs).toBe(700);
  });

  it('adding two tranches that together exceed the budget, concurrently, only lets one through', async () => {
    const prog = (await api(admin).post('/programmes', { name: `Tranche race ${uniq()}`, budgetGhs: 1000 })).data;
    const addTranche = () => api(admin).post(`/programmes/${prog.id}/tranches`, { label: `t-${uniq()}`, amountGhs: 600 });
    const [r1, r2] = await Promise.all([addTranche(), addTranche()]);
    const statuses = [r1.status, r2.status].sort();
    expect(statuses).toEqual([201, 400]);

    const overview = (await api(admin).get(`/programmes/${prog.id}/budget`)).data;
    expect(overview.tranches.length).toBe(1);
    expect(overview.tranches[0].amountGhs).toBe(600);
  });
});
