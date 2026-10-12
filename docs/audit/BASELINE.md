# Business Doctor — Baseline Evaluation

Started 2026-10-09, continuing work from the same session that already fixed (prior to this
baseline being written):

- Migration 0043 (delivery coordination) registration gap — fixed, verified: `migrations/meta/_journal.json`
  now lists it (idx 43) and `tests/*` exercise its routes end to end.
- Silent-500 bug class: six call sites across `src/domain/programme-operating-model.ts`,
  `src/domain/programme-workspace.ts`, `src/domain/programme-workspace-configuration.ts`,
  `src/domain/programme-entitlements.ts`, `src/services/common.ts` threw a plain `Error`
  instead of a typed `ApiError`, surfacing as an opaque 500 instead of the correct 4xx. All fixed.
- TOCTOU capacity races: provider-assignment activation, workspace role/participant adds, and
  cohort enrollment (three independent call sites) all now serialize on
  `lockCapacityScope()` (Postgres advisory transaction lock). All fixed, each with a live
  concurrency regression test proving exactly one of two racing requests wins.
- Cross-tenant IDOR: `getParticipant()` read a participant by id without a workspace-scope
  check, unlike every sibling function in the same file. Fixed; regression test added.
- Admin settings UI for Zoom/Teams/WhatsApp/SMS/e-signature/accounting: configuration and
  connectivity-test only (not send/sync), credentials env-var-only, never persisted or returned.

This file is the running baseline for the master completion programme. It records VERIFIED
findings only — things actually inspected in this repository, not assumed from the master
prompt's suggested checklist. Where the master prompt's suggested checklist item was checked
and found already correct, that is recorded explicitly below rather than silently skipped, so
the register reflects real coverage.

## Verified sound — no gap found (checked this session)

| Area | What was checked | Verdict |
|---|---|---|
| Paystack webhook | `src/services/finance.ts:paystackWebhook` — HMAC-SHA512 signature, constant-time compare (`safeEqual`), idempotent via `webhookEvents` unique-conflict dedup keyed on `event:data.id`, amount+currency re-verified server-side before `settle()`, mismatch recorded not silently accepted | Sound |
| KoboToolbox intake | `src/services/kobo.ts` — dedup by `submissionUuid` against `diagnostics` table, secret-header check on the webhook path, unknown-case names reported via `SystemError` event rather than silently dropped | Sound |
| Certification lifecycle | `src/services/certificates.ts` — eligibility beyond "assessment completed" (reviewed diagnosis + approved prescription + published framework + evidence share required), separate proposer/decider with conflict-of-interest checks (`u.id === c.proposedBy`, lead/coach exclusion), eligibility re-checked at decision time (not just proposal time), expiry via `validUntil`, revocation path, public verification endpoint gated by `verifyPublic` flag, full audit trail on every transition | Sound |
| Migration journal | `migrations/meta/_journal.json` — sequential `idx` 0..45, no gaps or duplicates in the journal itself. File-name numbering skips 0044 (no file ever existed at that number per `git log --all`), which is cosmetic only — the journal's `idx` sequence, not the filename number, is what Drizzle's migrator walks | Sound (filename gap is cosmetic, not a registration defect) |
| AI diagnosis/prescription pipeline | `src/services/ai.ts`, `src/domain/job-handlers.ts`, `src/services/clinical.ts`, `src/domain/logic.ts` — scores computed only by deterministic business rules (AI never writes `healthScores`), structured-output validation (hand-rolled schema + forbidden-claims scan) before any persist, independent proposer/decider gate before an AI draft becomes authoritative, bounded retry (2 attempts, 45s timeout each) with no silent-success-on-failure, model/prompt/snapshot versioning on every request, owner-uploaded evidence *text* never forwarded into an AI prompt at all (only the evidence code is) | Sound, with two low-severity gaps fixed (GAP-010) and noted (retry/backoff undifferentiated between timeout and invalid-JSON, not yet fixed — low severity, no user-facing defect) |

## Audit documents

This baseline is the entry point. Companion documents, created/updated as work proceeds:

- `docs/audit/FUNCTIONAL_GAP_REGISTER.md` — open findings across all priority areas, with id, severity, evidence, status
- `docs/audit/SECURITY_FINDINGS.md` — security-specific findings (subset of the gap register, kept separate per the master prompt's requested structure)
- `docs/audit/TEST_EVIDENCE.md` — exact commands run, pass/fail counts, per round

Not yet created (will be added as the corresponding workstream is actually touched, to avoid
scaffolding empty documents that create a false impression of coverage):
`REQUIREMENTS_TRACEABILITY.md`, `DATA_INTEGRITY_FINDINGS.md`, `INTEGRATION_STATUS.md`,
`RELEASE_READINESS.md`.
