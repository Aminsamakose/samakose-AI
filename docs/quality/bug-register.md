# Bug and risk register

Opened from the Section 127 audit. Severity: High means wrong results or data exposure, Medium means a workflow or governance gap, Low means polish. Status is as of this commit.

| ID | Finding | Severity | Status |
|---|---|---|---|
| BR-01 | Editing a question could change how history was explained, because scores read the live bank | High | Fixed: scores and diagnostics point at a frozen framework version; published versions cannot be changed |
| BR-02 | Specialised frameworks could in principle go live without evidence | High | Fixed: publishing needs an evidence trail with every source approved, by an administrator |
| BR-03 | No single view of an organisation's history | Medium | Fixed: Business Health Record |
| BR-04 | Architecture note stated 9 roles, 24 resources and 41 routes | Low | Fixed: now 11 roles, 29 resources, 58 pages, 179 API operations |
| BR-05 | No migration history table on the production database; migrations applied by hand | High | Partly fixed: `npm run db:history` and `baseline` command written and tested locally. Production history not yet recorded; waiting for your go-ahead |
| BR-06 | No separate staging database found | High | Open: needs approval to create (inside the GHS 4,000 staging allowance) |
| BR-07 | AI drafts never run against the live model | Medium | Partly fixed: synthetic library and `npm run ai:eval` ready. Live run waits for a Claude API key from Amin |
| BR-08 | COACH and CONSULTANT roles overlap | Medium | Fixed and live: one EXPERT role. Lead-only actions (diagnostics, diagnoses, prescriptions, evidence, verification) stay with the lead expert on each case. Actions assign, verify and certify added; certify is reserved for administrators and has no route yet |
| BR-09 | No load testing | Medium | Open |
| BR-10 | Screen-reader and text-alternative audit not done | Medium | Open |
| BR-11 | An AI draft could repeat a certification or guarantee claim found in its input (found by the synthetic injection case) | High | Fixed: drafts containing certification, guarantee or readiness claims are rejected by the validator |
| BR-12 | Migration 0011 backfill failed on any database that already held diagnostics or scores (append-only triggers). Production held none, so it was unaffected. Found while preparing browser tests | High | Fixed: guards lifted only around the two backfill statements, then re-enabled. Verified on a database with existing rows. Re-check on the staging copy of production |
