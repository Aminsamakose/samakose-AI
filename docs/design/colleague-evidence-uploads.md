# Colleague evidence uploads: design

Status: draft for approval. No code or migrations have been written for this design.

## 1. Problem

A colleague answering their area in a team round can only mark an answer Self-reported, Unverified or Missing. The documents that prove an answer (a bank statement, a licence, sales records) usually sit with that colleague, not the owner. Today the owner has to collect them and upload them. This slows rounds, and answers that could be Document-supported stay Self-reported, which lowers evidence coverage and so the confidence in the score and the chance of certification.

## 2. Principles

1. A colleague can add proof for their own answers. They cannot read the business's other documents.
2. Evidence class stays a fact the server checks. A colleague may reach Document-supported only with a document that exists and belongs to the business. Verified stays with experts and reviewers.
3. The owner remains accountable: they see every upload before submitting and can remove one from a round.
4. Same file rules as today: type allowlist, content check, size limit, fingerprint, audit entry. No new storage.
5. Scoring is unchanged. It still reads the evidence class and reference on each answer.

## 3. Options

| Option | How it works | For | Against |
|---|---|---|---|
| A. Reuse `documents` with ownership by uploader (recommended) | Colleague upload route under `/me/` stores a normal `documents` row for the business, with `uploaded_by` set to the colleague. A colleague can list and attach only documents they uploaded. The owner sees all. | No new table. Same checks, audit and download fingerprint. Smallest change. | A colleague sees only their own uploads, so two colleagues cannot share a document (the owner can attach it for them). |
| B. Colleague sees all business documents | Colleague may attach any document of the business | Easy sharing | Exposes unrelated documents (payroll, contracts) to every invited person |
| C. Send files to the owner by email | Colleague emails; owner uploads | No build | The problem stays; no audit trail of who supplied what |

Recommendation: A. It follows principle 1 and needs no table, so the migration is limited to one index and, if wanted, a document-source marker.

## 4. Behaviour under option A

- **Upload:** `POST /me/documents` (multipart). Allowed for a colleague with at least one confirmed area in an open round and for the owner. Stored with `uploaded_by` = the person, `org_id` = their business, `case_id` = the round's case. Rate limit: 20 files a day per person (proposed).
- **List and download:** `GET /me/documents` returns the caller's own uploads (the owner gets all business documents for the open round). Download is checked against the fingerprint as today.
- **Attach:** the answer's `ref` carries the document code. The answer route accepts Document-supported from a colleague only when the document belongs to the business and was uploaded by that colleague (or the owner assigned it, see below). Otherwise the answer is refused with a plain message.
- **Owner review:** the Team assessment card lists uploads per area with who added them. The owner can detach a document from an answer before submitting. Removing a file from storage is not offered (nothing is permanently deleted without a separate decision).
- **Submission:** the existing data quality gate still demands a real document for any Document-supported answer, so a detached document cannot slip through.
- **Consent:** invited colleagues already accept the team invitation notice. The notice should be reviewed by counsel to say that documents they upload become part of the business's assessment record. This is wording, not a data change.
- **Quarantine:** if the scanning step marks a document Quarantined, it cannot be attached and the answer falls back to Self-reported with a message.

## 5. Data changes

| Change | Purpose |
|---|---|
| Index on `documents (org_id, uploaded_by)` | Fast "my uploads" and owner review |
| None otherwise | Reuses `documents`, `responses.evidence_ref` and the audit log |

An optional later addition: a link table to let the owner share one document across several answers or colleagues. Not needed now.

## 6. Risks and mitigations

| Risk | Mitigation |
|---|---|
| A colleague uploads someone else's sensitive file | Audit entry per upload; owner sees it before submission; type allowlist and size limit |
| A document is attached to an answer it does not support | Class stays Document-supported, not Verified. Experts verify in the normal evidence step |
| Storage abuse | Daily rate limit and existing size limit |
| Colleague leaves the business | Their uploads remain in the record (append-only audit); access to new uploads ends with removal |
| Personal data in documents (IDs, payslips) | Guidance text at upload; counsel review of the notice; retention period still to be set by Amin |

## 7. Tests that would accompany the build

- A colleague cannot list or download another person's upload or any business document they did not upload.
- A colleague cannot mark Document-supported without a valid own document; cannot mark Verified.
- Detached documents cannot reach scoring.
- Wrong file type, oversize file and content mismatch are refused as today.
- Rate limit and audit entry exist.
- The score does not change because of who uploaded.

## 8. Decisions needed from Amin

| Decision | Recommendation |
|---|---|
| Option A, B or C | A |
| Daily upload limit per person | 20 |
| Whether colleagues may see each other's uploads | No; the owner shares by attaching |
| Notice wording on uploads | Counsel to confirm before go-live |
| Retention period for uploaded documents | Amin to set (already open for data retention) |

## 9. Build size

One migration (an index), one service module, two routes under `/me/`, a panel on the answer screen and an owner review list. Roughly the size of Phase A feedback.
