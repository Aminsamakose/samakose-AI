# Platform Integration Review: Expert Network, Coach Network and Profile Photos

Business Doctor by Samakose. Prepared 4 October 2026. Status: for approval. No implementation has started.

## 1. Executive summary

The Expert and Coach frameworks describe a mature, evidence-driven practitioner network: verified profiles, intelligent matching, four-part performance scoring, rating confidence, appeals and outcome learning. The platform today has the delivery plumbing (cases, sessions, actions, KPIs, reviews, audit) but almost none of the practitioner layer. An expert or coach is a login with a name, an email and a role.

Our recommendation is to integrate, not add. Build one Practitioner Profile attached to the existing user identity, turn case assignment into a recorded history, capture ratings from the first engagement, and defer everything that needs engagement history (outcome-adjusted matching, time decay, specialisation scores, "Exceptional" status) until the data exists.

Three findings drive the design:

1. **There is no engagement record.** A case holds one lead expert, one coach and one reviewer as plain columns that are overwritten on reassignment. The only history is the audit log, and it carries no reason. The frameworks assume engagements, acceptance, decline and override reasons. This is the foundation everything else rests on.
2. **The scoring models cannot produce meaningful results yet.** "Exceptional" needs 20 completed engagements and 10 rated ones. The platform has none today and six nominated UAT participants. If we build the full scoring engine now it will display "Limited Evidence" for everyone for a long time. We should capture the data now and switch the engine on later.
3. **The workflow order differs from the framework.** Today people are assigned at intake. The framework matches practitioners after the prescription is approved (CONNECT). We need two-stage assignment: a lead expert early for diagnosis, specialist experts and a coach after prescription.

Profile photos are straightforward if done once, on the user identity, with private storage. They must not reuse the website media library.

## 2. What exists, what to reuse, what to change, what is missing

| Area | WHAT EXISTS | REUSE | CHANGE | MISSING |
|---|---|---|---|---|
| Identity | `users`: name, email, one role, org, MFA, active flag. Profile page edits name, password and MFA only. | Single users table and the single EXPERT role (standing decision). | Profile page becomes the home of the practitioner profile and photo. | Any professional information, any photo. |
| Roles | ADMIN, EXECUTIVE, PROGRAMME_MANAGER, EXPERT, REVIEWER, FINANCE, OWNER, RESPONDENT, FUNDER, CONTENT_EDITOR, SITE_MANAGER. EXPERT already covers advising and coaching. | RBAC grant table in `rbac.ts`. | Nothing. Coach and Expert become functions on a profile, not roles. | MEL, QA, tester and Development roles do not exist. See section 5. |
| Assignment | `cases.consultantId`, `coachId`, `reviewerId`. `assignCase` checks the person is active and has the right role, and that reviewer differs from lead. Audit records before and after. | `assignCase` validations, notifications, audit. | Becomes a write through a new assignment record. Add reviewer differs from coach. | Accept or decline, reason, match snapshot, several specialists per case, history that is queryable. |
| Delivery | `coaching_sessions` (Scheduled, Held, Missed, Cancelled), `actions` (owner, due, done), `kpis` and `kpi_readings`, `risks`, `evidence`, `documents`. | All of it. These become the system performance data (section 3 of the rating framework). | Link sessions and actions to an assignment, not only to a case. | Per-engagement success measure. |
| Feedback | `feedback` table: app feedback and owner view of a score. Administrator-only, never reaches scoring or reports. | Rate limiting, the "owner feedback never alters a score" principle. | Keep as is. It is a different purpose from practitioner ratings. | Practitioner ratings from client, reviewer and programme manager. |
| Governance | `audit_log`, `approvals` (record type, decision, reason), `events`, `jobs`, `notifications`. AI agents are registered, versioned and gated (`agents.ts`, `agent-gate.ts`). | All. Status changes use `approvals`. Scheduled scoring uses `jobs`. A matching recommender is registered as an agent or a deterministic function. | Add reason capture to assignment audit. | Appeals. |
| Files | Storage driver (disk or blob) with magic-byte validation in `media.ts`. `documents` is organisation and case scoped evidence. `media_assets` serves website content. | The storage driver and the validation rules (extract to a shared helper). | None. | A private, per-user photo path. Using `media_assets` would expose staff photos through the CMS permission set. Using `documents` needs an organisation id that staff do not have. |
| Dashboards | Expert dashboard (lead cases, coach sessions) and coach view inside `dashboards.ts`. Admin "View as". | Extend these in place. | Add performance, capacity and profile completeness panels. | Network Intelligence view for management. |
| Journey | Case states PROSPECT to RE-ENTRY. | State machine in `logic.ts`. | Map to the nine journey stages (section 6). | A distinct CONNECT step. I found no distinct UNLOCK capability and need your confirmation of what it should contain. |
| Money | Client contracts, invoices and payments. | Not applicable. | None. | Practitioner fees, payables and revenue share. |

## 3. Integration architecture and sources of truth

```
USER (identity, role, photo)  one row, one photo
  |
  +-- PRACTITIONER PROFILE (Expert and/or Coach functions)
  |      specialisations, sectors, platforms, languages, regions, credentials,
  |      capacity, vetting status, conflict declarations
  |
  +-- ASSIGNMENT (case, person, function: lead / specialist / coach / reviewer)
  |      status: Proposed > Accepted | Declined > Active > Completed | Reassigned
  |      match snapshot (score and breakdown at the time), reason, previous holder
  |        |
  |        +-- delivery already in the platform: sessions, actions, KPIs, evidence
  |        +-- RATINGS (client, reviewer, programme manager), append-only
  |        +-- ENGAGEMENT SUCCESS (computed: participation, actions, milestones, KPI, score movement)
  |
  +-- PERFORMANCE SNAPSHOT (period, specialisation, score, sample size, confidence,
         formula version), written by a scheduled job, never edited
         |
         +-- STATUS (Good Standing ... Suspended) via approvals + audit + appeals
```

| Component | Source of truth | Not duplicated because |
|---|---|---|
| Name, role, email, photo | `users` plus one photo reference | One identity for every person. |
| Professional profile | `practitioner_profiles` (new) | Nothing else holds it. |
| Who is on a case | `case_assignments` (new) | `cases.consultantId` and `coachId` stay as a read-through pointer to the current active assignment, written only by the assignment service. |
| Delivery activity | Existing session, action, KPI and evidence tables | System metrics are computed from them, never copied. |
| Ratings | `engagement_ratings` (new) | Separate from `feedback`, which stays administrator-only. |
| Score and status | `performance_snapshots` (new) and `approvals` | Snapshots are append-only and carry the formula version. |
| Business Health outcome | `health_scores` and `kpi_readings` | Outcome is read, not stored again. |
| Weights, thresholds, decay | Versioned configuration, same pattern as `framework_versions` | Administrator-set, audited, never hard-coded. |

One dashboard family: the existing role dashboards gain panels. No separate "Coach app" or "Expert app".

## 4. Advantages and disadvantages

**Advantages**
- One identity, one photo, one profile. No competing versions of a person.
- Assignment history, override reasons and accept or decline become auditable, which donors and the Data Protection Commission will expect.
- Ratings start accumulating from the first real engagement, so outcome learning becomes possible later without a back-fill.
- Existing role dashboards are extended, so the user experience does not fragment.
- Fits the governed-AI position: the match is a recommendation, a person decides.

**Disadvantages and risks**

| Risk | Detail | Mitigation |
|---|---|---|
| Over-engineering | The full framework is a platform in itself. Building it all before there is data is expensive and produces empty screens. | Phase the work. Defer scoring that needs history. |
| Small-sample unfairness | With two or three engagements, any score is noise and may harm a person's standing. | Show "Limited Evidence" with sample size. No status above Good Standing without the minimum evidence. Thresholds configurable. |
| Causation | A business improving does not prove the practitioner caused it. Weak implementation by the client is not the practitioner's fault. | Keep client engagement and prescription quality as separate measures. Outcome carries 20 percent but never decides status alone. |
| Migration of live cases | Existing cases hold assignments as columns. | One migration creates an Active assignment per existing pointer, then the pointers become read-through. Verified in rehearsal first. |
| Privacy | Photos, credentials, rates and ratings are personal data. | Consent notice, access limited to people in the same case scope, rates visible to administrators only, DPC registration scope updated. |
| Rating gaming and retaliation | Owners could rate to punish or reward. | Ratings only after a milestone, one per engagement, reviewer and system data weigh in, appeal route. |
| Performance | Network-wide scoring jobs and dashboards. | Snapshots computed by a scheduled job. Dashboards read snapshots. |
| Maintenance | Weights and thresholds will change. | Versioned configuration, formula version stored on every snapshot. |

## 5. Recommendations (KEEP, ENHANCE, CONSOLIDATE, MIGRATE, ADD, REMOVE, DEFER)

| Decision | Item |
|---|---|
| KEEP | Single EXPERT role. `feedback` as administrator-only. Audit log and approvals. Reviewer must differ from lead. Governed AI with human authority over scores and status. |
| ENHANCE | Profile page (photo and practitioner profile). `assignCase` (reason, accept or decline, reviewer differs from coach). Expert and coach dashboards. Admin user page (vetting status, capacity). |
| CONSOLIDATE | Photo handling into one identity capability and one shared avatar component. Image validation into one shared helper used by media and photos. Coach and Expert networks into one practitioner profile with functions. |
| MIGRATE | `cases.consultantId` and `coachId` into `case_assignments`, keeping the columns as read-through pointers. |
| ADD | `practitioner_profiles`, `case_assignments`, `engagement_ratings`, `rating_appeals`, `performance_snapshots`, configuration for weights and thresholds, user photo reference, explainable rule-based matching, conflict-of-interest declaration. |
| REMOVE | Nothing. The audit-only assignment history stays as the legacy record. |
| DEFER | Outcome-adjusted matching. Time-decay. Specialisation scores. Exceptional and Excellent statuses. AI analysis of feedback. Earnings, fees as payables and revenue share. Separate roles for MEL, QA, testers, developers. |

**On the roles listed in the brief.** The platform has one user table and one role per person. MEL and impact officers are served by the EXECUTIVE and PROGRAMME_MANAGER views. QA and workflow testers are UAT participants, not a role. Assessors and diagnostic specialists are experts acting as lead. Development and product team members are administrators. Adding eight roles would create permission sprawl for no behaviour that differs, and it would break the single-role decision. Photos still apply to all of them because they are all users.

**Prerequisites.**
1. PR #29 (library dimension map) merged so the matching vocabulary is stable. Practitioner dimension strengths should use the same eight live dimensions and the AgriFood360 and ESO360 names mapped in `library-map.ts`.
2. The content-cache connection timeout fixed, because profile pages and photo reads add traffic on the same database.
3. Your decisions in section 11.

## 6. User experience by role

| Person | What changes |
|---|---|
| Business owner and respondents | Optional photo. See the assigned lead, specialists and coach with photo, short bio and credentials. Rate the engagement after a milestone. Cannot see other businesses' ratings. |
| Expert and coach | Complete a profile (completeness bar), upload a photo, state capacity and availability, declare conflicts. Accept or decline proposed assignments with a reason. Own performance panel with sample size and confidence. Appeal a rating. |
| Programme manager | Match recommendations with the breakdown, one-click accept, override with a mandatory reason. Capacity and workload view. Rates programme-manager ratings. |
| Reviewer | Rates deliverable and evidence quality. Cannot be the lead or the coach on the same case. |
| Administrator | Approves practitioner profiles (vetting), sets weights and thresholds, handles appeals, sees the network view. |
| Finance | No change in phase 1 to 5. |
| Executive and funder | Network summary and aggregate outcomes only. No individual ratings. |
| All | Same avatar everywhere: dashboards, assignments, case records, reviews, comments, matching. Initials fallback. |

The experience stays the same across SME360, AgriFood360 and ESO360. Only the specialisation and sector filters differ.

## 7. Impact on the Business Doctor journey

| Stage | Case state today | Contribution | Workflow change |
|---|---|---|---|
| CHECK | ONBOARDING, PROFILED | Lead expert proposed at intake by platform, sector, capacity | Lead is proposed and accepted, not just set |
| DIAGNOSE | DIAGNOSTIC, DIAGNOSED | Lead expert reviews diagnosis | None |
| PRESCRIBE | PRESCRIBED, APPROVAL | Specialist input, reviewer approval | None |
| CONNECT | none (implicit) | Specialists and coach matched against the approved prescription | New: assignment proposal after prescription approval |
| TREAT | IN EXECUTION, COACHING | Delivery by specialists, coach implements | Sessions and actions link to the assignment |
| MONITOR | MONITORING, MIDLINE | Coach accountability, system metrics | None |
| CERTIFY | certificates | Practitioners supply evidence, never certify | None |
| UNLOCK | not found as a distinct step | Needs your definition | To be confirmed |
| RE-CHECK | ENDLINE, FOLLOW-UP, RE-ENTRY | Sustainability and outcome ratings feed practitioner scores | Outcome rating requested after follow-up |

The one real workflow change is the CONNECT step. The case state machine does not need a new state: assignment proposals are tracked on the assignment record.

## 8. Data and governance impact

**New entities**

| Entity | Key fields | Rules |
|---|---|---|
| `practitioner_profiles` | user, functions (expert, coach), bio, specialisations, dimension strengths, sectors, platforms, business sizes, languages, regions, delivery modes, years, credentials, capacity (max active, availability), vetting status, conflict declarations | Versioned by audit. Vetting status changes through `approvals`. Rates visible to administrators only. |
| `case_assignments` | case, user, function, specialisation, status, proposed by, match score and breakdown snapshot, reason, replaces, accepted at, ended at | Append-only. Reassignment closes one row and opens another. |
| `engagement_ratings` | assignment, source (client, reviewer, programme manager), component scores, comment, rater | One per source per assignment. Never edited. Corrections are new rows. |
| `rating_appeals` | rating, appellant, grounds, evidence, decision, decided by, date | Original rating preserved. |
| `performance_snapshots` | person, specialisation, window, component scores, overall, sample size, confidence, status suggestion, formula version | Append-only. |
| Configuration | weights, evidence thresholds, decay, confidence bands | Versioned and audited. |
| User photo | storage key, mime, size, hash on the user identity | Private storage. |

**Permissions.** New resources `practitioners`, `assignments`, `ratings`. Experts edit their own profile only. Programme managers and administrators assign. Only administrators approve vetting and decide appeals. Rating visibility follows section 6.

**Audit.** Every assignment, override, vetting decision, rating, appeal, status change and configuration change is audited with who, what, why and when. No record is deleted. AI never decides status.

**Photos.** Types PNG, JPEG, WebP, validated by content not file name, 2 MB limit, stored privately, served only to signed-in users within case or organisation scope, replace and remove supported, initials fallback, removal on account deletion. A consent line is added to the privacy notice. Photos are personal data under the Data Protection Act 2012 (Act 843), so DPC registration scope must include them.

## 9. Implementation impact

| Area | Impact |
|---|---|
| Data model | Migrations 0028 onward. Applied to production only after your explicit "go" and verified, as for 0027. All new tables owned by `samakose_app` with RLS on. |
| Roles | No new role. Three new permission resources. |
| Workflow | Two-stage assignment, accept or decline, reason on override. |
| UI | Shared avatar component, profile page sections, assignment drawer with match breakdown, rating prompts, practitioner panels. |
| AI agents | Matching starts as a deterministic, explainable function. If an agent is later used for narrative summaries it is registered in the agent registry, read-only, human-approved. |
| Testing | Formula tests, confidence and threshold tests, photo validation and access-control tests, RLS rehearsal, journey test updated for assignments, regression for migration of existing pointers, synthetic UAT re-run, accessibility check of avatars. |
| Risks | Section 4. |

**Recommended sequence**

| Phase | Scope | Gate |
|---|---|---|
| 0 | Prerequisites and your decisions | Approval |
| 1 | Identity: photo capability, shared avatar, practitioner profile, vetting, capacity | Migration "go" |
| 2 | Assignments as records, accept or decline, override reason, migration of existing cases | Migration "go" |
| 3 | Rule-based, explainable matching with conflict and capacity checks | None |
| 4 | Rating capture and system metrics, rating confidence display | Migration "go" |
| 5 | Performance snapshots, statuses, appeals, network view | After real engagements exist |
| 6 | Outcome-adjusted matching, time-decay, specialisation scores | After enough engagement history |

Phases 1 to 4 deliver the identity, accountability and data capture. Phases 5 and 6 should wait for evidence, which is also what the framework's own governance principles require.

## 10. Honest gaps in the framework itself

- Revenue share, fees and payments appear in profiles and dashboards. The platform has no payables. This needs a commercial and tax decision, and a contract template for practitioners.
- Weights (15/20/15/15/15/20) and thresholds (20 engagements, 10 ratings) are sensible defaults but unvalidated for Northern Ghana volumes. They will need recalibration.
- Client satisfaction is correlated with outcome and with client engagement. Treating them as independent inflates confidence. Reviewer and system data should anchor the score.
- Outcome attribution is the weakest measure. It should inform matching, not punish people.
- Coach and expert share the EXPERT role, so one person can hold both functions on different cases. Conflicts such as coaching a case where they are also the specialist need a rule.

## 11. What requires your approval

1. **One role, two functions.** Keep a single EXPERT role with Expert and Coach as functions on the profile (recommended), or split into separate roles.
2. **Vetting gate.** Only approved practitioner profiles appear in assignment lists. Existing experts are grandfathered once their profile is completed (recommended).
3. **Two-stage assignment.** Lead at intake, specialists and coach after prescription approval (recommended).
4. **Photo policy.** Optional for owners and respondents, expected for practitioners, private within case scope, never public unless a practitioner opts in for the website team page (recommended). Confirm consent wording and DPC scope.
5. **Defer list.** Outcome-adjusted matching, time-decay, specialisation scores, Exceptional status, earnings and revenue share (recommended).
6. **Scoring defaults.** Adopt the framework weights and thresholds as version 1 configuration, editable by the administrator.
7. **Rating visibility.** Practitioners see their own scores with sample size. Owners see only the assigned team's profile. Executives and funders see aggregates only.
8. **UNLOCK stage.** Tell me what this stage should contain, because I found nothing distinct for it in the platform.
9. **Start.** Authorise Phase 0 and Phase 1 once the above are settled.
