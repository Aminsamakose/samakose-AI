# Business Health Architecture v2: bank specification

Status: DRAFT. Nothing in these banks is production-authoritative until Amin Yahaya signs off. Weights, thresholds and gates are provisional proposals until calibrated on pilot data.

Machine-readable plan: `plan.json` (domains, sub-dimensions, question counts, readiness indices per platform). Validator: `node scripts/validate-bank.mjs docs/frameworks/banks/<file>.json`.

## 1. Architecture

Eight common domains (D1 to D8) in every platform. Each platform renames and specialises the domains and sub-dimensions (see plan.json). Exactly 100 questions per platform, fixed count per sub-dimension.

Readiness is not a ninth dimension. It is derived: each readiness index is a weighted score over tagged questions plus gate rules (section 4).

## 2. Item schema (one JSON object per question)

| Field | Rule |
|---|---|
| code | Prefix + 3 digits: SM-001..SM-100, AF-001..AF-100, ES-001..ES-100. Order follows domain then sub-dimension. |
| domain, subDimension | Codes from plan.json, for example D3 and 3.2. |
| text | One idea, plain English, 20 to 280 characters, in the voice the respondent or assessor will be rated on. Ghana-appropriate wording. No double-barrelled statements. No em dashes. |
| responseType | ANCHORED (five behavioural anchors, default), BANDED (a number or ratio converted to 0-4 by cutpoints written into the anchors), YNP (anchors only at 0, 2, 4; 1 and 3 are null), FREQ (Never to Always, anchors written out). Stored value is always an integer 0 to 4. |
| anchors | Array of 5 strings for values 0,1,2,3,4. Each under 220 characters and able to stand alone (never "As 3, plus"), observable, mutually exclusive. YNP uses null at index 1 and 3. 0 is absent or harmful practice, 4 is good practice that can be evidenced. |
| evidence | Object: requirement (what a verifier looks at or asks for), method (one of Document, Observation, Digital record, Third party, Interview), examples (1 to 3 concrete items). |
| weight | Integer 1 to 5. 5 survival or gate-level (max 12 items per bank), 4 high materiality, 3 standard, 2 supporting, 1 hygiene (max 6 items). |
| criticality | Gate (blocks readiness if low; 10 to 16 per bank), Core (25 to 45 per bank), Standard (rest). |
| readiness | Array of readiness index codes from plan.json (0 to 3 per question). |
| applies | "All" or a short condition such as "Cooperative or group only". At most 8 conditional questions per bank. |
| basis | Sourced, Partly sourced, or Design judgement. Be honest. Design judgement is allowed, but must be at most 25 percent of the bank. |
| sources | Array of source ids from the bank's sources map. Required (non-empty) when basis is Sourced or Partly sourced. |
| legacy | Existing draft or live code this question evolved from, or null. |
| riskTag | Short plain label shown in the risk register when this item scores 0 or 1, for example "No cash flow visibility". |
| consistencyGroup | Optional short id when this item pairs with another for a contradiction check. |

## 3. Scoring logic (shared)

- Item score s in {0,1,2,3,4}. Normalised value = s / 4.
- Evidence multiplier applied by the platform (already live): Verified 1.0, Document-supported 0.95, Self-reported 0.8, Unverified 0.6, Missing 0.5. Rules can override per version.
- Domain score = sum(weight x value x multiplier) / sum(weight), over answered applicable items, scaled to 100.
- Overall = weighted over all items (domain weight share follows item weights, so domain shares are an outcome of item weights, reported in the instrument; target between 8 and 18 percent per domain).
- Maturity bands (live rules): Critical below 40, Fragile 40 to 59, Developing 60 to 74, Strong 75 and above.
- Data quality gate: at least 90 percent of applicable items answered.
- Confidence: High when verified or document-supported weight share is at least 60 percent, Medium at 35 percent, otherwise Low (live rules).

## 4. Readiness (shared rules)

Each readiness index R is scored 0 to 100 using only questions tagged with it (same formula as domains). Level rules, provisional:

| Level | Condition |
|---|---|
| Not ready | Index below 45, or any Gate question tagged to R scores 0 or 1 |
| Emerging | Index 45 to 59 and all tagged Gates at 2 or more |
| Conditionally ready | Index 60 to 74 and all tagged Gates at 2 or more |
| Ready | Index 75 or more and all tagged Gates at 3 or more |

Each index must draw on at least 10 questions, at least 2 Gates, and at least 4 different domains. The platform shows the blocking items for every index that is not Ready.

## 5. Risks, gaps and priorities (shared rules)

- R1 Critical item gap: weight 4 or 5 item scoring 0 or 1.
- R2 Weak domain: domain score below 40; Watch domain: 40 to 59.
- R3 Evidence gap: in a domain, verified plus document-supported weight share below 35 percent.
- R4 Contradiction: a consistency check fires (each bank lists 6 to 10).
- R5 Concentration: three or more R1 items in one sub-dimension marks the sub-dimension Critical.
- Priority score for an item = weight x (4 - score) / 4 x (1 + 0.25 x number of readiness indices it unlocks) x (1.25 if Gate). The top 5 sub-dimensions by summed priority score become the priority areas. Provisional.

## 6. Diagnosis to measurement mapping (one row per sub-dimension)

Fields: gapPattern (what low scores in this sub-dimension typically look like), diagnosis (plain statement the platform drafts for the case), prescription (the decision or action the enterprise should take), intervention (type from Training, Coaching, Tool or template, Linkage, Technical assistance, Peer learning; ownerRole COACH or CONSULTANT; typicalDays integer 5 to 120; resources), measurement (kpi, baselineMethod, provisionalTarget six months, dataSource, frequency). Targets are provisional until baseline data exist.

## 7. Reliability and validity design (what the bank must carry)

- Behavioural anchors on every item, evidence requirement on every item, consistency checks, evidence multipliers.
- Content validity: expert panel review, item-level content validity index target 0.78 or more with 6 to 10 experts.
- Cognitive interviews with 5 to 8 real respondents per platform before wide use.
- Pilot analysis once at least 100 completed cases per platform exist: item discrimination, omega or alpha per domain target 0.70 or more, floor and ceiling effects under 15 percent, weight sensitivity test.
- Inter-rater agreement on assessor-rated items: weighted kappa target 0.60 or more on a double-rated subset.
- Criterion validity: association with observed outcomes (loan access, repayment, revenue growth, funding secured).
- None of this is claimed as achieved. The instrument is evidence-informed and pre-validation.

## 8. Source rules

Every source in the bank's `sources` map: id (S1...), title, publisher, year, url, confidence (High, Medium, Low), opened (true only if the page or document was actually opened and read). Do not invent sources, URLs or statistics. Use web search and fetch to verify. A source seen only in a search snippet is opened:false and may only support Partly sourced items.

## 9. Output file

`docs/frameworks/banks/<platform>-bank-v1.json` with keys: framework, version ("1.0.0-draft"), status, architecture, generated, domains (code, name), subDimensions (code, domain, name, expected questions, mapping object from section 6), questions (schema above), readiness (code, name, purpose, gates summary, level rules reference "SPEC 4", plus per-index note on what action unlocks), consistencyChecks (id, itemA, itemB, rule in plain words, condition: for example "A>=3 and B<=1"), sources (map), notes.

## 10. Rules added after the first authoring pass

- Not applicable: a conditional question (applies is not "All") that does not apply is excluded from the numerator and denominator of every score and from the completion gate. A conditional Gate that does not apply counts as passed for readiness. The platform now supports this (migration 0013): an answer of `{ "notApplicable": true }` is accepted only for questions whose `applies` is not "All", is stored with `responses.not_applicable`, and is left out of every score, index and completion count. Not built yet: the form control for N/A in the web UI, and Kobo import for v2 question codes (Kobo still reads Q-codes only).
- Readiness breadth: an index that draws on more than 40 percent of the bank (some AgriFood360 and ESO360 indices do) is a screening indicator, not a discriminating one. Calibrate and narrow after pilot data.
- Thin indices: ESO360 RDY-LNK has the minimum 10 questions. Treat its level as indicative until more items are added in version 1.1.
- Legal items (Ghana statutes, registration forms, licence rules) must be checked by a Ghanaian lawyer before the instrument is used in the field.
- Cutpoints in BANDED items are design proposals, not benchmarks. Replace them with sample medians or lender and buyer thresholds once data exist.
