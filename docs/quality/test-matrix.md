# Test matrix

What is verified, where, and what is not yet verified. "Not verified" is stated plainly so nobody reads a gap as coverage.

| Area | Verified by | Evidence | Gap |
|---|---|---|---|
| Authentication, lockout, MFA | `tests/auth.test.ts`, `registration.test.ts` | Automated, real PostgreSQL | No external penetration test |
| Role and permission matrix | `tests/security.test.ts` | Every guarded route is called as every role and compared with the matrix | Row-level scoping is tested for main entities, not every list endpoint |
| Row-level security in the database | `tests/rls.test.ts` | Every public table must have RLS enabled | Policies are deny-by-default; the app connects as the owner role |
| Case lifecycle | `tests/journey.test.ts`, `workflow.test.ts` | Automated | None known |
| Scoring | `tests/logic.test.ts`, `tests/regression/golden.test.ts` | Unit tests and golden synthetic cases | AgriFood360 and ESO360 have no content to test |
| Framework versions and immutability | `tests/frameworks.test.ts` | Version link, trigger immutability, publish gating, role limits | None known |
| Business Health Record | `tests/frameworks.test.ts` | Scope, owner access, funder denial, change reasons | No browser test of the page yet |
| AI drafts | `tests/journey.test.ts`, `tests/integrations.test.ts`, `tests/ai` | Mock model, injected transport, four synthetic cases with governance checks (no invented figures, no certification claims, evidence ids only from the supplied list) | Not run against the live Claude API. `npm run ai:eval` is ready and waits for a Claude key |
| AI agent governance | `tests/agents.test.ts`, `e2e/agents.ts` | Lifecycle moves, live-model gate, autonomy cap, version freeze, pause and resume, refused tasks recorded and the requester told, usage limits, role limits | No agent has passed a live evaluation, so the Active path is tested only with a recorded test pass |
| Payments | `tests/integrations.test.ts`, `pricing.test.ts` | Mock mode and stubbed transport | Not run against live Paystack |
| Website content and pricing display | `tests/content.test.ts`, `pricing.test.ts` | Automated | Content review is a human task |
| Browser journeys | `npm run test:e2e` | Playwright journeys at desktop and phone width | Not part of `npm test`; run before releases |
| Accessibility | e2e overflow checks | Partial | No screen-reader test, no text alternatives audit |
| Load and soak | none | none | Not measured |
| Migrations from scratch | `npm run db:rehearse` | Applies every migration to a throwaway database and checks RLS on all tables | Not yet run against a copy of production data. Needs the staging database |
