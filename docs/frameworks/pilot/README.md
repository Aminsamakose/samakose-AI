# Pilot study protocol and analysis tooling

Purpose: collect enough real assessments to test whether each bank is reliable, discriminating and useful, and to recalibrate weights and thresholds from evidence. Targets come from section 7 of `docs/frameworks/banks/SPEC.md`.

## Design

| Item | Plan |
|---|---|
| Sample | At least 100 completed cases per platform. Fewer than 100 gives indicative results only, and the report says so. |
| Who | Real nominated participants. Mix of sizes, sectors, districts and, for AgriFood360, crops and value chain roles. For ESO360, mix of ESO types and ages. |
| Before the pilot | Expert panel complete and changes from it applied (see `docs/frameworks/panel`). Cognitive interviews with 5 to 8 respondents per platform. Banks published and sources approved. |
| Double rating | At least 30 enterprises per platform assessed by two different assessors within 14 days, independently, for the agreement check. |
| Outcomes | Collect 6 and 12 months after the diagnostic: loan applied for and approved, repayment on time, revenue change, funding secured, buyer contract signed, as relevant. Keep the case reference so outcomes can be matched. |
| Consent | Participants agree that anonymised answers are used to improve the instrument. Raters appear only as a short hash in exports. |

## Files

| File | Use |
|---|---|
| `scripts/pilot/export-responses.ts` | Exports validated responses for one framework to CSV. |
| `scripts/pilot/pilot_analysis.py` | Runs the analysis (Python 3 with numpy, scipy and pandas). |

```
DATABASE_URL=... npx tsx scripts/pilot/export-responses.ts SME360 pilot-sme360.csv [--version 2]
python3 scripts/pilot/pilot_analysis.py analyse docs/frameworks/banks/sme360-bank-v1.json pilot-sme360.csv results/sme360 [--outcomes outcomes.csv] [--draws 500]
python3 scripts/pilot/pilot_analysis.py selftest
```

Outcomes file: one row per case, a `case` column with the case reference, then one column per outcome. A column of only 0 and 1 is treated as yes or no. Anything else is treated as a number.

## What the analysis reports

| Output | Meaning |
|---|---|
| Reliability per domain | McDonald's omega from a one factor model, and standardised alpha. Target 0.70 or more. |
| Floor and ceiling | Share of cases in the bottom or top five points of each domain score. Target under 15 percent each. |
| Items to review | Weak item-rest correlation (under 0.20), answers piled at 0 or 4, often not applicable or unanswered. |
| Weight sensitivity | Rank correlation, change of maturity band and change of readiness level when weights are equalised, evidence multipliers are ignored, or every weight is moved by one point at random. The pass target is proposed by the tool and needs agreement. |
| Inter-rater agreement | Quadratic weighted kappa by domain and overall on double-rated cases. Target 0.60 or more. |
| Criterion validity | AUC for yes or no outcomes and rank correlation for numeric outcomes, for the overall score, each domain and each readiness index. |

Everything is in `report.md`, with `items.csv`, `domains.csv`, `sensitivity.csv`, `inter_rater.csv` and `criterion.csv` beside it.

## Reading the results carefully

- A domain mixes practices that need not move together (a business can keep good cash records and still have no written plan). Treat a low omega as a prompt to review the domain, not as proof it is wrong.
- The built-in test uses simulated data to check the maths and the pipeline. Its figures say nothing about the banks.
- The tool describes the pilot sample. It does not show the banks are valid for other populations. Say so in any funder or donor material.
- Decisions that follow from the analysis (new weights, gates, thresholds, removed questions) are major version changes and need Amin's approval. Keep the data and the report with the new version as its audit trail.
- Replace the design proposed cut points in BANDED questions with sample medians or lender and buyer thresholds once data exist.
