# Registration routing: data design (step 2)

Status: draft for approval. No code or migrations have been written for this design.

## 1. Principles

1. Consent comes before data. Before consent, only an email address and a password exist.
2. The scoring engine is not changed. It still receives one full answer set at submission. Routing only decides who fills which answers.
3. Job role, platform role, permission, assessment responsibility and assessment ownership are separate things. Only permission is enforced, and it comes from assignment rows checked on the server.
4. Demographics and disability never enter a score or a diagnosis. An automated test enforces this.
5. Nothing is hard-coded to Ghana. Country, locations, consent wording and reporting thresholds are data.
6. Every new table is owned by the application role (lesson from migration 0018) and every migration includes the guarded ownership statement.

## 2. Phase 1 (migration 0019)

| Table | Purpose | Key columns |
|---|---|---|
| `country_settings` | One row per country. Ghana is the first. | country_code (ISO 3166-1 alpha-2), name, currency, phone_code, default_language, level_labels (for example Region, District, Community), data_protection_regime, regulator_name, youth_max_age, active |
| `geo_units` | Location hierarchy, loaded as reference data | id, country_code, level, parent_id, code, name, active, source, source_date |
| `consent_notices` | Versioned consent wording | id, purpose, country_code, version, text, effective_from, status |
| `consents` | One row per grant or withdrawal. Append-only. | id, user_id, org_id, notice_id, action (granted or withdrawn), at, source (registration, profile, invitation) |
| `registration_answers` | The routing inputs captured at registration | user_id, org_id, platform, job_role, job_role_other, responsibility, assessment_mode, suggestion_source (rule, user), created_at |
| `role_mappings` | Versioned, Administrator-managed mapping (draft in `docs/frameworks/role-mapping`) | id, framework_code, version, status (Draft, Published, Retired), data (jsonb), created_by, approved_by, approved_at |
| `demographic_profiles` | Optional demographics and disability, kept apart from the organisation record so access and withdrawal are simple | id, subject_type (user or organisation), subject_id, fields (jsonb), consent_id, updated_at |

Columns added to `organisations`: `country_code` (default GH), `geo_unit_id` (district), `community`, `urban_rural`, `years_operating`, `ownership_structure`.

Disability data lives only in `demographic_profiles`, tied to its own consent row. Withdrawing the consent deletes that field. It is not exposed through the expert, reviewer or finance routes. Only the owner and the Administrator can read the individual answer.

Reporting: aggregate counts only, through a database view that applies a minimum group size (rule `report.min_cell_size`, default 5), so a small district never reveals an individual business.

Prefill: every prefilled value is saved with its source (typed, suggested then confirmed, from an invitation). A prefilled value is never saved until the person confirms it.

## 3. Phase 2 (migration 0020, after UAT)

| Table or change | Purpose |
|---|---|
| New account type `RESPONDENT` (a platform role with no default permissions) | A colleague's account. Access comes only from assignments. Adding a value to the role type is safe. Removing one later is not, so it is added once, deliberately. |
| `org_members` | org_id, user_id, job_role, status (invited, active, removed), invited_by |
| `assessment_rounds` | An assessment in progress for a case: case_id, framework_version_id, mode, mapping_version, status (Planning, Collecting, Ready, Submitted), owner_id |
| `assessment_assignments` | round_id, sub_dimension, respondent (nullable), status, suggested_by (rule, ai, owner), confirmed_by, confirmed_at |
| `response_drafts` | Saved answers before submission: round_id, question_code, value, evidence, answered_by, updated_at |
| `responses` gains `answered_by`, `assignment_id` | Who answered each item, kept in the Business Health Record |
| `diagnostics` gains `assessment_round_id`, `assessment_mode` | Mode shown with the score |
| Invitations reuse the existing token table with a new kind | Expiry, rate limit, and only from a verified organisation |

On submission the owner finalises the round. The system builds the full answer map from the drafts and calls the existing submission, so scoring, the data quality gate and the audit trail work exactly as they do now.

Rules on combining answers: each question belongs to one sub-dimension and therefore to one assignment, so there are no overlapping answers by default. If the owner reassigns an area, the earlier answers are kept in history. The existing consistency checks run across respondents, and conflicts are flagged for the expert and not averaged.

Gate rule: submission is refused until every gate question is answered and every sub-dimension that contains a gate has a named respondent.

Built in slice B (migration 0022): `assessment_rounds` and `response_drafts` as above, `responses.answered_by`, and `diagnostics.assessment_round_id`. Two simplifications against the table above, both deliberate. Assignments stay per business (`area_assignments`, from slice A) and are not copied per round, so a reassignment takes effect at once and the earlier answer is kept in the audit trail (`round.draft_replaced`). The round pins the framework version it was opened under, and submission is checked and scored against that version. `diagnostics.assessment_mode` is not added yet.

## 4. Access control

- A respondent can read and answer only their own assignments. They cannot read other sections, scores, diagnoses or prescriptions.
- A suggestion from the mapping engine or the AI never changes an assignment by itself. The owner accepts, modifies or reassigns. Low confidence always asks.
- Every mapping change, assignment change and consent change is written to the audit trail.

## 5. Migration and release plan

1. Write the migration files with the ownership block and journal entries.
2. Run on the local rehearsal database (`npm run db:rehearse`).
3. Wake staging, apply, fingerprint-compare against the chain, test, pause again.
4. Apply to production only on explicit approval, then verify table ownership with the standing check query.
5. Read-only production walkthrough.

## 6. Tests required

- Routing matrix: every role, three platforms, three modes, correct sections routed.
- Consent: no data stored before consent; per-purpose consent; withdrawal removes optional data.
- Disability data hidden from expert, reviewer and finance routes.
- Demographics and disability never change a score (identical answers, different demographics, identical score).
- Small-group suppression in aggregate views.
- Respondent isolation (Phase 2).
- Existing unit, browser and accessibility suites.

## 7. Open points

- The official source for Ghana's regions and districts. Wikipedia currently reports 16 regions and 261 metropolitan, municipal and district assemblies. These can change, so the list must be loaded from the official source and dated.
- Consent wording for each purpose, to be reviewed against Act 843 before go-live.
- Youth age limit (35 proposed) as a country setting.
