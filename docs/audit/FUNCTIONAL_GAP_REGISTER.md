# Functional Gap Register

Status values: **Open**, **Fixed**, **Verified sound** (checked, no gap found). Every row has
real evidence — a file, a commit, or a test — not an assumption from the master checklist.

| ID | Area | Severity | Finding | Status | Evidence |
|---|---|---|---|---|---|
| GAP-001 | Delivery coordination | High | Migration 0043 existed on disk but was unregistered in the journal | Fixed | commit `b3d46e8` |
| GAP-002 | Error handling | Medium | `assertProgrammeTransition`/`assertConfigurationTransition`/`assertCapacity` threw plain `Error`, surfacing as 500 instead of 409 | Fixed | commit `cb74c12` |
| GAP-003 | Concurrency | High | Provider-assignment activation had a TOCTOU capacity race (two concurrent activations both passed a max=1 cap) | Fixed | commit `cb74c12`, `tests/provider-assignment.test.ts` |
| GAP-004 | Concurrency | High | Workspace role/participant adds had the same TOCTOU race | Fixed | commit `bcdd1d6`, `tests/entitlement-capacity.test.ts` |
| GAP-005 | Error handling | Low | `assertWithinEntitlement`, workspace lifecycle guards threw plain `Error` (not yet wired to any route, but same bug class) | Fixed | commit `0dec24c` |
| GAP-006 | Concurrency | High | Cohort enrollment capacity checked-then-acted from three independent call sites (case creation, participant cohort assignment, admin capacity edit) with no shared lock | Fixed | commit `0dec24c`, `tests/cohort-capacity-race.test.ts` |
| GAP-007 | Access control | **High** | `getParticipant()` read a programme participant by id with no workspace-scope check, unlike every sibling function in the file — any role holding bare `programme_workspaces:read` could read another programme's participant by guessing UUIDs | Fixed | commit `a2aadc0`, `tests/security-idor-audit.test.ts` |
| GAP-008 | Integration config | Medium | No admin-facing configuration/connectivity-test surface existed for Zoom/Teams/WhatsApp/SMS/e-signature/accounting | Fixed | commit `d1064c4` |
| GAP-009 | Concurrency | **High** | `createCase`'s and `assignCohort`'s cohort-capacity lock (GAP-006) serialized the *count* re-read correctly but still compared it against a `capacity` value read *before* the lock was acquired — a concurrent `updateCohort` capacity edit landing in that window was invisible to the check, defeating the lock | Fixed | re-read capacity after the lock in both call sites; caught by `tests/cohort-capacity-race.test.ts`'s second case, which failed intermittently in the full suite run before this fix |
| GAP-010 | AI safety | Low | `opportunity_reader` eval suite only exercised one prompt-injection shape (an attempt to set `criteria.minOverall`); a differently-worded injection (fabricating the provider name, claiming universal pre-approval) had no test coverage | Fixed | added `injection-fabricated-provider-and-preapproval` case to `READER` suite in `src/domain/ai-eval.ts` |
| GAP-011 | Concurrency | Low (open) | `addMember`'s workspace-role capacity check reads `workspace.configuration` (which carries the entitlement limit) before acquiring `lockCapacityScope`, the same pattern that caused GAP-009 — but here the limit only changes through a multi-step configuration draft/submit/approve workflow, not a single concurrent PATCH, so the exploit window is much narrower. Not fixed this round; re-read the configuration after the lock (or re-derive the limit from a value read after acquiring it) when this area is next touched | Open | `src/services/programme-workspaces.ts:addMember` |
| N/A | Paystack webhook | — | Checked for missing signature verification / non-idempotent handling | Verified sound | `src/services/finance.ts:paystackWebhook`, see BASELINE.md |
| N/A | KoboToolbox intake | — | Checked for missing dedup / webhook auth | Verified sound | `src/services/kobo.ts`, see BASELINE.md |
| N/A | Certification | — | Checked for "certified solely because assessment completed" | Verified sound | `src/services/certificates.ts`, see BASELINE.md |
| N/A | Migration journal | — | Checked the 0043/0044 numbering discrepancy named in the master prompt | Verified sound (filename gap is cosmetic) | `migrations/meta/_journal.json`, see BASELINE.md |

## Open (not yet investigated this session)

None currently open — every workstream started this session reached Fixed or Verified sound.
The master completion programme names many areas not yet touched (AgriFood360/ESO360 framework
content, CONNECT matching depth, Google Meet/Zoom live integration, full E2E journey automation,
performance/load testing, AI evaluation harness). Those are tracked as **not yet started**, not
as "open defects" — do not read their absence from this table as a finding; it means the
corresponding audit pass has not run yet. See the chat transcript for the standing plan to work
through them in priority order across sessions.
