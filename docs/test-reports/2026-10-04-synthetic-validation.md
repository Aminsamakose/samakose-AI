# Business Doctor Platform: Test and Readiness Report

**Date:** 4 October 2026 | **Prepared for:** Amin Yahaya, Founder, Samakose Accelerator Lab
**Method:** end-to-end validation with clearly labelled synthetic data ("TEST ... (Synthetic)", addresses at `@uat.samakose.test`) on an isolated database built from the real migrations. Production was not written to. Evidence: `uat/results.json` (136 recorded checks), harness `uat/validation.test.ts`.

## Executive summary

The core assessment-to-prescription workflow works and is well governed: registration, role capture, routing, self and hybrid assessments, scoring, human review, four-eyes approval, reports, dashboards, permissions and audit all behaved as designed in 111 of 136 checks. Ten checks failed, five were partial and ten exposed capabilities that do not exist yet.

**Recommendation: CONDITIONAL GO** for the supervised pilot with the six nominated UAT participants on SME360 only. **NO-GO for open public launch** until the five blockers in section 10 are closed.

| Result | Count |
|---|---|
| PASS | 111 |
| FAIL | 10 |
| PARTIAL | 5 |
| GAP (capability absent) | 10 |
| Total checks | 136 |

Important limits: AI ran in mock mode (the live AI test is on hold), so model quality and cost were not tested. Screens were not driven in a browser, so UX findings come from API behaviour and code review. Email delivery was log-only. Section 9 lists what remains untested.

## 1. Tests executed

Synthetic population: 6 business owners (2 each on SME360, AGRIFOOD360, ESO360, one self mode and one hybrid mode per platform), 5 experts with different expertise (agribusiness value chains; SME finance and investment readiness; organisational development and governance; digital and AI transformation; gender inclusion and climate resilience), 2 reviewers, 1 programme manager, 1 finance officer, 1 funder, 1 executive, 1 admin, 1 colleague respondent, plus one programme and one cohort.

Areas covered: registration and onboarding; role and responsibility capture; assignment and routing; self, collaborative and hybrid assessment; question-level routing; AI analysis and scoring; Business Health Record; prescriptions; expert matching; workflow monitoring; review and approval; notifications and tasks; case progression; reporting and dashboards; role permissions; admin overrides and reassignment; audit trail; error handling and edge cases; contracts, programmes and organisations.

## 2. Scenarios and results

| Area | Result |
|---|---|
| Registration and onboarding (25 checks) | All pass: email confirmation gate, profile gate, weak password, admin self-registration blocked, consultant pending then approved, organisations start unverified |
| Role and responsibility capture | Pass: job role and assessment mode captured at registration; owner invites colleagues with a job role; area suggestions from the role mapping; colleague cannot invite or assign |
| Assignment and routing | Pass for assignment, four-eyes, reassignment history, expert sees only own cases. Platform routing works in code. Expert matching is a gap (section 8) |
| Assessments | Self (mode recorded as self) and hybrid (owner plus colleague, mode recorded as hybrid, respondents tracked) pass. Quality gate, duplicate submission id and a concurrent double submit all behave correctly |
| Question-level routing | Pass on the 100-question SME360 framework: colleague and owner see disjoint question sets, out-of-area and out-of-range answers refused |
| AI, review, prescriptions | Wiring, AI-drafted flag, review authority, four-eyes and return loop pass. Prescription content fails (section 8) |
| Health Record, progression, reports | Pass: history across diagnostics, three held sessions move the case to Monitoring, report hidden from owner until the case reviewer releases it |
| Dashboards and monitoring | All eight role dashboards load in under 10 ms. Funder view suppresses small groups and shows no names |
| Permissions | Cross-business isolation holds. Three programme-manager findings (section 7) |
| Admin overrides | Pass: reasoned switch override, account unlock, deactivation ends the session, reassignment audited |
| Edge cases | Pass: malformed ids, bad JSON, injection text, duplicate organisation in same region, capacity limit, brute-force throttle, spoofed uploads. One fail (draft cohort) |

## 3. Successful workflows

Registration to verified organisation; self and hybrid assessment through the same data quality gate; expert diagnosis review; prescription submission, return, revision and approval by the correct reviewer only; conversion of approval into owner actions with dates; owner action completion with an evidence note; coaching sessions to monitoring; report release control; funder aggregate-only view; audit trail with no secrets; admin unlock and override.

## 4. Failed or partial workflows

| ID | Result | Finding |
|---|---|---|
| T056 | FAIL | AGRIFOOD360 and ESO360 cases are served the SME360 questions. Their banks exist as Draft in production, so routing falls back |
| T062, T069, T129 | FAIL | Prescriptions collapse to one item and one action per case: the 16-item library uses six legacy dimension names and none matches the eight dimensions of the live framework |
| T100 | FAIL | Programme manager can list contracts for organisations outside their programme |
| T101 | FAIL | Programme manager can open any organisation and its case list |
| T117 | FAIL | A Draft cohort accepts enrolment |
| T125 | FAIL | An invoice of GHS 99,999 was accepted against a GHS 5,000 contract |
| T130 | FAIL | Completing a programme leaves its cohorts Open |
| T110 | FAIL (code-verified, not executed) | Automatic contract expiry writes no audit record |
| T102, T111, T057, T064, T094 | PARTIAL | Programme manager can rename shared organisations; 16 audit rows carry email addresses; AI is mock only; reminder jobs not exercised |

## 5. Bugs

Ranked: (1) T100 and T101 data exposure; (2) T062/T069/T129 prescription library mismatch; (3) T056 platform fallback; (4) T125 over-invoicing; (5) T117 and T130 cohort and programme lifecycle; (6) T110 unaudited expiry; (7) T102 shared master data editable by programme managers.

A subagent review had also claimed that contracts accept an invalid programme. The test refuted this: an unknown programme is refused. Only the missing programme field on screens remains.

## 6. UX and UI issues

Not driven in a browser in this run. From behaviour and code: owners have no contract view (403) although they see invoices; the case payload carries no platform label for staff; no overdue or ageing view for managers; reports have no PDF or Word export. A visual walkthrough is the recommended next test.

## 7. Permission and role issues

Strong overall: owner A cannot read, write or search owner B; funder gets no case routes and no names; reviewers cannot export; experts see only assigned cases; finance cannot read case content; four-eyes holds throughout. Gaps: programme manager contract and organisation reads (T100, T101) and edit rights on shared organisation data (T102).

## 8. AI and assessment issues

- Library and framework mismatch is the most serious assessment-quality finding. In production the library holds 16 items on Finance, Market and sales, Operations, People and governance, Compliance and finance access, Records and systems. The live framework has eight different dimensions. Even a real AI model will be choosing from a menu that does not match the scores.
- AGRIFOOD360 and ESO360 cannot assess with their own frameworks until approved.
- There is no expert expertise, availability or workload model (T035, T039): matching is a manual pick from a name list, so the five expertise profiles could not be matched by the system, only by a human.
- Real AI output quality, cost per case and the USD 5 cap were not tested.

## 9. Performance and integration issues

Responses were fast on this small dataset (assessment submit 60 to 70 ms; lists and dashboards under 10 ms). This is not a load test. Not exercised: real SMTP delivery, Paystack, Kobo, live AI, scheduled reminder jobs, browser rendering, mobile.

## 10. Critical risks and blockers

1. Programme manager data exposure (contracts, organisation detail): data protection exposure ahead of DPC registration.
2. Prescription library does not match the live framework.
3. AGRIFOOD360 and ESO360 frameworks unapproved, so two of three platforms run on the SME bank.
4. No over-invoicing guard on contracts.
5. Cohort and programme lifecycle inconsistencies and an unaudited contract expiry.

## 11. Recommended fixes

| Priority | Fix | Effort |
|---|---|---|
| Must | Scope contracts and organisation detail to the programme manager's programmes; restrict shared organisation edits | Small |
| Must | Rebuild the intervention library against the eight live dimensions (content plus a map table) | Medium, needs your sign-off |
| Must | Approve AGRIFOOD360 and ESO360 frameworks, or disable those platforms until approved | Your decision |
| Must | Block invoices above remaining contract value; audit contract auto-expiry | Small |
| Should | Refuse enrolment into Draft cohorts; cascade programme completion; count graduated cases out of capacity | Small |
| Should | Expert expertise tags, availability and caseload limit; bulk reassignment | Medium |
| Should | Owner contract view; signatory and acceptance evidence; renewal alerts | Medium |
| Could | Indicators and gender, youth and disability disaggregation; report PDF export; platform label on cases | Medium |

## 12. Overall readiness rating

| Dimension | Rating |
|---|---|
| Workflow integrity and governance | 8 / 10 |
| Security and permissions | 7 / 10 (after the PM scoping fix, 9 / 10) |
| Assessment and prescription quality | 4 / 10 (library and framework mismatch) |
| Multi-platform readiness | 4 / 10 (SME360 ready; two platforms in Draft) |
| Finance and contracts | 5 / 10 |
| Programme management | 5 / 10 |
| Overall | 6 / 10: ready for supervised pilot, not for open launch |

## 13. Recommendation

**CONDITIONAL GO.** Proceed with supervised UAT for the six nominated participants on SME360 provided fixes 1 and 4 ship first and the library mismatch is disclosed to participants or fixed. Do not open AGRIFOOD360 or ESO360 assessments or public registration until the frameworks are approved and the library is rebuilt. Re-run this suite after fixes; it is repeatable with one command.

## Data handling

All synthetic records lived only in an isolated database, which was dropped after this report was saved. Production data, configuration, frameworks, migration history and audit records were not touched.
