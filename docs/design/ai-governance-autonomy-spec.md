# AI governance and autonomy: specification

Status: draft for approval. No code or migrations are written from this document.

## 1. Purpose

The platform already caps every AI agent at Level 2 (recommend, a person approves). This specification defines what must be true before any agent may run on the live model, and what would have to be built and approved before any step above Level 2. The default answer to "can an agent act alone?" is no.

## 2. Principles

1. Human authority over official outputs. A score, diagnosis, prescription, certificate or report is never created or changed by an agent on its own.
2. An agent is a worker, not a user. It has no login and no permissions of its own, and runs inside the requester's account and case scope.
3. Evidence before trust. An agent is Active only after a passed evaluation of its exact version.
4. Every action is attributable, reversible where possible and audited with the agent version.
5. Cost and volume are capped. A cap that is reached pauses the agent; it never silently continues.
6. Refuse and hand over. When a task is outside the agent's remit, it says so and the person does the work by hand.

## 3. Autonomy levels

| Level | Meaning | Status | Example here |
|---|---|---|---|
| 0 | No AI | Built | Scoring engine, gates, certification rules |
| 1 | Suggest on request; nothing is stored as fact | Built | Enquiry Assistant answers from published FAQs |
| 2 | Draft or recommend; a named person approves before it counts | Built, the cap | Diagnosis and prescription drafts |
| 3 | Acts on low-risk, reversible items, then reports; person can undo | Not built | Not proposed |
| 4 | Acts within a budget and scope, person reviews samples | Not built | Not proposed |
| 5 | Acts with oversight by exception | Not built, not planned | Not proposed |

Never eligible for Level 3 or above, whatever the evidence: scores and gate outcomes, certificate decisions, anything shown to a donor or investor as verified, consent and data rights handling, payments and refunds, and changes to roles or permissions.

## 4. Gate to run on the live model

An agent may run live only when all of the following hold. The first three are enforced today.

1. State is Active.
2. Its current version has a passed evaluation.
3. It is within its usage limits.
4. The cost cap for the month is set by the administrator (today the limits are placeholders).
5. A named owner is recorded for the agent.
6. The evaluation set is approved by Amin as Data Protection Lead and reviewed by an expert from the panel, covering the agent's refusals as well as its answers.

Item 4 and item 5 are new and need a small change to the registry. Item 6 is a process step.

## 5. Evaluation standard

| Test | Pass mark (proposed, to be set by the panel) |
|---|---|
| Schema-valid replies | 100% |
| Stays on approved sources, no invented figures | No failures in the set |
| Refuses prices, promises, scores, certification claims | 100% |
| No personal data sent or returned beyond minimal context | No failures |
| Expert rating of usefulness (1 to 5) | Average 4 or more |
| Agreement with expert judgement on a blind sample | Threshold set by the panel before the run |

The live evaluation (`npm run ai:eval`, USD 5 cap) stays on hold until Amin releases it. Results are stored against the version and cannot be edited.

## 6. Monitoring after go-live

| Signal | Trigger | Response |
|---|---|---|
| Refusal rate | Sudden rise or fall | Review prompts and sources |
| Schema failure after retry | Above 2% of requests in a week | Pause and investigate |
| Person overrides the draft | Above an agreed share | Re-evaluate the version |
| Feedback marked "not accurate" (Phase A) | Any cluster on one agent output | Triage within a week |
| Spend | 80% warning, 100% pause | Administrator decision |

The Phase A feedback table already captures whether a score matched the business. Those answers are the first real-world accuracy signal and feed the panel's review.

## 7. Incident handling

1. Any administrator can pause or disable an agent at once, with a reason.
2. Affected outputs are listed from `ai_requests` and the audit log (by agent version).
3. Each affected output is re-reviewed by a person; wrong ones are superseded, not deleted.
4. If personal data was involved, Amin as Data Protection Lead decides on notification under the Data Protection Act, 2012 (Act 843) and the Commission's rules. Counsel to confirm timelines.
5. A short write-up is kept with the agent record.

## 8. What moving to Level 3 would require

All of these, for a specific named task, never for an agent in general:

- A written case for the task, its risk and its undo path, approved by Amin.
- Six months of live Level 2 operation with override rate and error rate inside agreed limits.
- An undo that works without engineering help.
- A new evaluation set for the task, a database check changed deliberately (the current cap is in the application and the database), and a migration approved on its own.
- Expert panel sign-off and a note to participating businesses.

## 9. Decisions needed from Amin

| Decision | Recommendation |
|---|---|
| Monthly AI cost cap | Set a figure before any live run |
| Agent owner for each agent | Amin until a second owner is appointed |
| Pass marks | Let the expert panel propose; Amin approves |
| Release of the live evaluation | After the cap and the approved evaluation set exist |
| Any Level 3 task | None for now |

## 10. Build items that follow approval

Small and independent: a required owner field and a monthly cap check in the agent gate, a monitoring view for the signals in section 6, and a version-linked incident list. None of these is started.
