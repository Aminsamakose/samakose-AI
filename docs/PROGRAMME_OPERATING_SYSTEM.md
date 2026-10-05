# Programme Operating System

## Purpose

The Programme Operating System is an operating layer on top of the existing Business Doctor engine. It does not replace diagnostics, scoring, prescriptions, cases, providers, the Business Health Record, finance, or the nine-stage Business Doctor journey.

> ONE GOVERNED BUSINESS DOCTOR. MANY PROGRAMME WORKSPACES. MANY DELIVERY ORGANISATIONS. MANY PROGRAMMES. ONE LONGITUDINAL BUSINESS HEALTH RECORD PER BUSINESS. MEASURABLE, VERIFIED OUTCOMES.

## Target architecture

Samakose Business Health Ecosystem
→ Business Doctor Engine
→ Programme Operating Model
→ Programme Workspace
→ Team / Providers / Finance
→ Cohorts / Participants
→ Cases
→ CHECK → DIAGNOSE → PRESCRIBE → CONNECT → TREAT → MONITOR → CERTIFY → UNLOCK → RE-CHECK
→ Business Health Record
→ Outcomes / MEL / Funder Reporting

## Core distinction

- **Programme**: the funded initiative, with funder, dates, budget, objectives and lifecycle.
- **Programme Workspace**: the secure operational environment for delivering that programme.
- **Programme Configuration**: how the programme uses the centrally governed Business Doctor methodology.
- **Programme Delivery**: team, providers, cohorts, participants, cases, activities, schedules and interventions.
- **Programme Results**: indicators, evidence, outcomes, MEL, learning and funder reporting.

## Programme Workspace requirements

Every active programme must have a dedicated workspace containing:

1. Overview and control-tower metrics
2. Programme setup and configuration
3. Programme team and programme-scoped permissions
4. Provider network: Samakose, Bring Your Own, or Hybrid
5. Participant intake, eligibility, selection, onboarding and consent
6. Cohort management
7. Case and Business Doctor delivery
8. Activities and intervention delivery
9. Scheduling and notifications
10. Risks, issues, dependencies and escalations
11. Budget, commercial status and entitlement usage
12. MEL, outcomes and evidence
13. Funder reporting
14. Programme documents and decisions
15. Audit history and closure

## Programme lifecycle

DRAFT → COMMERCIAL_REVIEW → INVOICED → PAYMENT_PENDING → APPROVED → CONFIGURING → READY → ACTIVE → PAUSED → COMPLETING → COMPLETED → CLOSED → ARCHIVED

Transitions must be explicit, permissioned and auditable. Closing a programme must not delete Business Health Records or historical evidence.

## Programme provider model

Each programme supports:

- `SAMAKOSE_NETWORK`: use vetted providers in the central network.
- `BRING_YOUR_OWN`: programme organisation supplies its own providers.
- `HYBRID`: combine both sources.

Programme-scoped provider access must not weaken central governance for framework versions, scoring rules, verification, certification or audit history.

## Programme entitlements

Commercial packages must be represented as enforceable entitlements rather than UI-only limits. Example dimensions:

- participant capacity
- programme managers
- assessors / reviewers
- experts
- coaches
- cohorts
- storage
- reporting tier
- MEL capabilities
- integrations
- API access
- white-label options

Entitlement checks belong in the service/domain layer and must be observable and auditable.

## Participant lifecycle

APPLICATION → ELIGIBILITY → SELECTED → INVITED → CONSENTED → ONBOARDED → COHORT_ASSIGNED → ACTIVE → COMPLETING → COMPLETED → WITHDRAWN / REJECTED

Participant identity must remain linked to the organisation and longitudinal Business Health Record. Programme participation is an engagement context, not a second business identity.

## Governance rules

1. No second diagnostic engine.
2. No second scoring engine.
3. No duplicate Business Health Record.
4. No silent changes to authoritative frameworks.
5. Programme configuration is versioned and auditable.
6. AI recommendations remain subject to the existing human approval model.
7. Programme-level access must be isolated by scope.
8. Funder visibility must respect configured privacy and suppression rules.
9. Historical programme results must remain reproducible using the framework/configuration versions active at the time.
10. Closure, suspension and cloning must preserve historical integrity.

## Build sequence

### Phase 1 — Foundation

- Programme Workspace model
- Programme Operating Model
- programme-scoped roles/permissions
- programme configuration/versioning
- package and entitlement enforcement

### Phase 2 — Delivery

- participant lifecycle
- cohorts
- programme team
- provider assignment
- activities
- scheduling
- notifications
- SLA/escalation
- risks/issues/dependencies

### Phase 3 — Commercial

- programme onboarding
- quote / contract / invoice / payment
- entitlement activation
- renewal / expansion
- usage metering

### Phase 4 — Results

- MEL indicator dictionary
- baseline / milestone / endline / re-check
- outcome attribution
- funder dashboards
- automated reporting
- programme learning

### Phase 5 — Intelligence

- Programme AI Orchestrator
- programme-specific AI context
- delivery risk prediction
- capacity-aware matching
- operational recommendations
- automated programme reporting

## Definition of done

A Programme Operating System capability is complete only when implementation, integration, permissions, tests, operational behaviour, failure paths and audit evidence are all present. A screen or API existing alone does not constitute completion.

## Initial implementation boundary

This branch deliberately starts with the domain contract and operating specification before changing production data structures. Database migrations must be generated from the authoritative Drizzle schema and rehearsed against staging before production application.
