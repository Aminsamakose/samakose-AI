# Synthetic validation, second run (4 October 2026)

Synthetic data on an isolated database, with the AI in mock mode. Production was not touched. This run follows the delivery, export and targets work.

## Result

| Status | First run | This run |
|---|---|---|
| Pass | 111 (of 133 recorded in the first report) | 140 |
| Fail | 10 | 0 |
| Partial | 4 | 4 |
| Gap | 6 | 5 |
| Total checks | 148 | 149 |

The first report counted 133 checks at the time it was written. The check list has grown since, so compare the failure column rather than the pass column.

## Resolved since the first report
Questions and prescriptions for every platform, manager scoping on contracts and organisations, draft-cohort enrolment, invoice limits, programme completion cascade, intervention library coverage (28 items on the eight current dimensions, with AgriFood and ESO dimensions mapped), report download as PDF and Word (T079), programme indicators and targets with live actuals (T131), session reminders and stalled-case escalations (T095, partly).

One correction: T129 was recorded as a failure because the probe compared raw framework dimension names with the library and skipped the platform's own mapping. The probe now applies the mapping. Production already holds the 28-item library.

## Still open
| Check | Status | What is missing |
|---|---|---|
| T091 | Gap | Funder breakdowns by gender, youth and disability. Grouping logic is written; the database step was blocked by a personal-data safeguard and is waiting for a decision |
| T126 | Gap | A business owner cannot view their own contract (invoices work) |
| T127 | Gap | Contract signatory, acceptance evidence, amendments and renewals |
| T132 | Gap | Budget lines, tranches and a logframe hierarchy (indicators and targets now exist) |
| T133 | Gap | Registration number or TIN, completeness score, duplicate merge, unarchive, ownership transfer |
| T095 | Partial | The daily 06:00 UTC schedule has not been observed running in production yet |
| T103 | Partial | A programme manager can rename a shared organisation record with no change approval |
| T058, T065 | Partial | The AI is in mock mode. Output quality and cost are untested because the live evaluation is on hold |

## What this does not show
Synthetic users are not real users. No real participant has used the platform. Real-user testing with the nominated participants, the live AI evaluation, a penetration test, a restore from a real production backup, and Data Protection Commission registration are all still to come. The platform's qualification level is unchanged: nothing above Q3.
