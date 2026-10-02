# Bug and risk register

Opened from the Section 127 audit. Severity: High means wrong results or data exposure, Medium means a workflow or governance gap, Low means polish. Status is as of this commit.

| ID | Finding | Severity | Status |
|---|---|---|---|
| BR-01 | Editing a question could change how history was explained, because scores read the live bank | High | Fixed: scores and diagnostics point at a frozen framework version; published versions cannot be changed |
| BR-02 | Specialised frameworks could in principle go live without evidence | High | Fixed: publishing needs an evidence trail with every source approved, by an administrator |
| BR-03 | No single view of an organisation's history | Medium | Fixed: Business Health Record |
| BR-04 | Architecture note stated 9 roles, 24 resources and 41 routes | Low | Fixed: now 11 roles, 29 resources, 58 pages, 179 API operations |
| BR-05 | No migration history table on the production database; migrations applied by hand | High | Open: rehearsal script and history table planned with the staging database |
| BR-06 | No separate staging database found | High | Open: needs approval to create (inside the GHS 4,000 staging allowance) |
| BR-07 | AI drafts never run against the live model | Medium | Open: harness planned; needs a Claude API key from Amin |
| BR-08 | COACH and CONSULTANT roles overlap | Medium | Approved for change: merge into EXPERT with assign, verify and certify actions |
| BR-09 | No load testing | Medium | Open |
| BR-10 | Screen-reader and text-alternative audit not done | Medium | Open |
