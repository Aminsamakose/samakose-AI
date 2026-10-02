# Expert panel protocol for the Business Health banks

Purpose: test whether the questions in SME360, AgriFood360 and ESO360 are relevant, clear and realistic to assess in Ghana, before any bank is used in the field. This is content validity evidence. It does not replace pilot data.

## What is in this folder

| Item | Use |
|---|---|
| `workbooks/<platform>-expert-review.xlsx` | The workbook sent to each expert. One Instructions sheet, one Expert sheet, one Ratings sheet with dropdowns. |
| `../../../scripts/panel/panel_kit.py` | Builds the workbooks and analyses the returned ones. |

Commands (Python 3 with openpyxl):

```
python3 scripts/panel/panel_kit.py make     docs/frameworks/banks/sme360-bank-v1.json  out.xlsx
python3 scripts/panel/panel_kit.py analyse  docs/frameworks/banks/sme360-bank-v1.json  returned_folder  results_folder
python3 scripts/panel/panel_kit.py selftest
```

Rebuild the workbooks whenever a bank changes, so every expert rates the same text.

## Who to invite

Six to ten experts per platform, with the same people allowed on more than one panel where their expertise fits.

| Platform | Aim for a mix of |
|---|---|
| SME360 | SME lender or microfinance credit officer, business coach, accountant or bookkeeping trainer, MSME programme officer, a business development service provider, a trade or regulatory officer |
| AgriFood360 | Agribusiness finance officer, extension or agronomy specialist, cooperative or FBO development specialist, aggregator or off-taker, post-harvest or food safety specialist, value chain programme officer |
| ESO360 | Incubator or accelerator manager, donor or programme funder, monitoring and evaluation specialist, ESO board member, safeguarding or governance specialist, an entrepreneur who has been through a programme |

Rules for the panel:

- At least two experts who work in Northern Ghana, and at least one who does not work for Samakose or a close partner.
- Declare conflicts of interest on the Expert sheet. A conflict does not exclude someone, but it is recorded.
- Include at least one lawyer or regulatory specialist across the panels, to check the legal and registration items (Ghanaian statutes, forms, licence rules). This is a separate check required by the bank specification.
- Invite two or three more people than needed, because some will not return the workbook.

## Running the round

1. Send the workbook with a short covering note, a return date (suggest 10 working days) and a named contact.
2. Offer a 30 minute call before the deadline to explain the scale. Do not discuss individual questions across experts, because that removes the independence of the ratings.
3. Send one reminder at the halfway point.
4. Save every returned workbook unchanged in one folder per platform, then run `analyse`.
5. Hold a short synthesis meeting to go through the flagged questions. Record the decision for each one.

## How to read the results

| Result | Meaning | Default action |
|---|---|---|
| Keep | Relevance I-CVI of 0.78 or more, clarity and fit acceptable | Keep as written |
| Keep, revise wording, anchors or evidence | Relevant, but clarity under 0.78 or anchors or evidence under two thirds agreement | Use the comments and suggested wording, minor version change |
| Revise or merge | Relevance 0.50 to 0.77 | Decide with the panel comments: reword, merge with a neighbour, or drop |
| Candidate to remove | Relevance under 0.50 | Remove unless there is a strong reason to keep, major version change |

Also review the gate votes and weight suggestions. They are advice from a small panel and should lead to a discussion, not an automatic change.

I-CVI is the share of experts rating relevance 3 or 4. The modified kappa adjusts that for chance agreement. With six experts, one disagreement gives 0.83 and two give 0.67, so a single dissenting expert does not remove a question but two do.

## Governance

- Panel results inform the decision. Amin signs off every change to a bank, as agreed.
- Wording, anchor and evidence edits are minor versions. Weights, gates, scale or question removal are major versions (see the bank specification).
- Nothing from the panel is shown to respondents. Experts are identified by number in all outputs, and the register of names stays confidential.
- Keep the returned workbooks and the decision log as the audit trail for the next due diligence by a funder.

## What this does not prove

Content validity says the experts judge the questions relevant and clear. It does not show that the scores are reliable or that they predict outcomes. Those need the pilot analysis described in section 7 of the bank specification.
