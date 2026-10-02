# Component ownership

Owner means the person accountable for the component's behaviour and for approving changes to it. Named owners are Amin Yahaya until other people are appointed. Roles in the second column are the working roles that review changes. No other names are assumed.

| Component | Where | Accountable | Reviewing role |
|---|---|---|---|
| Auth, sessions, MFA | `src/services/auth*`, `src/lib/crypto.ts` | Amin Yahaya | Security reviewer |
| RBAC matrix and scoping, including lead and coaching expert rules | `src/lib/rbac.ts`, `src/domain/scope.ts`, `tests/expert.test.ts` | Amin Yahaya | Role and permission tester |
| Scoring and rules | `src/domain/logic.ts`, `tests/regression` | Amin Yahaya (business sign-off) | Diagnostic and scoring specialist |
| Framework versions | `src/services/frameworks.ts`, migration 0011 | Amin Yahaya (publish sign-off) | Diagnostic and scoring specialist |
| Case state machine | `src/domain/logic.ts`, `src/services/cases.ts` | Amin Yahaya | Workflow tester |
| AI gateway and prompts | `src/services/ai.ts`, `src/domain/mockai.ts` | Amin Yahaya | AI tester, AI governance |
| Business Health Record | `src/services/record.ts` | Amin Yahaya | Integration tester |
| Finance and billing | `src/services/finance.ts`, `billing.ts` | Amin Yahaya | Finance reviewer |
| Website and content engine | `src/services/content.ts` | Amin Yahaya | Content owner |
| Data protection and consent | consent fields, audit, export | Amin Yahaya (interim Data Protection Lead) | Data protection lead |
| Database migrations | `migrations/`, `src/db/` | Amin Yahaya | Release owner |
