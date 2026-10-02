/** Signs in as every role and opens every page that role can reach: no errors, no overflow, a heading, at desktop and phone width. */
import { check, healthy, launch, login, problems, tally } from './lib';
import { can, type Resource } from '../src/lib/rbac';

const USERS: [string, string][] = [['ADMIN', 'admin'], ['EXECUTIVE', 'exec'], ['PROGRAMME_MANAGER', 'pm'], ['CONSULTANT', 'consultant'], ['REVIEWER', 'reviewer'], ['COACH', 'coach'], ['FINANCE', 'finance'], ['OWNER', 'owner'], ['FUNDER', 'funder']];
const PAGES: { path: string; need?: [Resource, any]; roles?: string[] }[] = [
  { path: '/dashboard', need: ['dashboard', 'read'] }, { path: '/cases', need: ['cases', 'read'] }, { path: '/my-case', roles: ['OWNER'] },
  { path: '/reviews', need: ['prescriptions', 'approve'] }, { path: '/actions', need: ['actions', 'read'] }, { path: '/sessions', need: ['sessions', 'read'] },
  { path: '/reports', roles: ['FUNDER'] }, { path: '/organisations', need: ['organisations', 'read'] }, { path: '/programmes', need: ['programmes', 'read'] },
  { path: '/finance/invoices', need: ['invoices', 'read'] }, { path: '/finance/payments', need: ['payments', 'read'] }, { path: '/finance/contracts', need: ['contracts', 'read'] }, { path: '/finance/plans', need: ['plans', 'read'] },
  { path: '/admin/users', need: ['users', 'create'] }, { path: '/admin/audit', need: ['audit', 'read'] }, { path: '/admin/settings', need: ['settings', 'read'] }, { path: '/admin/system', need: ['integrations', 'read'] },
  { path: '/notifications' }, { path: '/profile' }, { path: '/search?q=bag' }, { path: '/cases/new', need: ['cases', 'create'] }
];
(async () => {
  const b = await launch();
  for (const [role, slug] of USERS) {
    for (const vp of [{ width: 1280, height: 800 }, { width: 375, height: 740 }]) {
      const { ctx, page } = await login(b, `${slug}@demo.samakose.test`, vp);
      console.log(`${role} @${vp.width}`);
      for (const p of PAGES) {
        const allowed = p.roles ? p.roles.includes(role) : p.need ? can(role as any, p.need[0], p.need[1]) : true;
        if (!allowed) continue;
        const r = await healthy(page, p.path);
        check(r.status < 400 && r.errBox === 0 && !!r.h1 && !r.overflow && !r.url.includes('/login'), `${p.path}`, JSON.stringify(r));
      }
      await ctx.close();
    }
  }
  await b.close();
  console.log('\nRuntime problems:', problems.length);
  for (const p of problems.slice(0, 40)) console.log(' -', p.where, '|', p.what);
  const t = tally(); console.log(`\n${t.pass} passed, ${t.fail} failed`);
  process.exit(t.fail || problems.length ? 1 : 0);
})();
