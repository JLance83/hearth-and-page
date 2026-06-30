# Hearth & Page — Ontario Forms Inventory

**Generated:** 2026-06-30  
**Jurisdiction:** Ontario (Family Law Rules)  
**Source:** `/dist/public/pdfs/` + `fill_pdf.py` function audit  

---

## Summary

| Metric | Value |
|---|---|
| Total forms with fill functions | 26 |
| Total fillable fields across all forms | 2,299 |
| Standard AcroForm | 26 |
| LiveCycle / dotted-path AcroForm | 0 |
| Missing PDF on disk | 0 |

All 26 forms have a registered `fill_form*` function in `fill_pdf.py`.  
All 26 PDFs are present on disk and classified as fillable.

---

## Full Inventory

| Form | Title | Category | PDF Type | Fields | Pages |
|---|---|---|---|---|---|
| Form 10      | Answer                                             | response           | acroform   |     77 |     5 |
| Form 13      | Financial Statement (Support Claims)               | financial          | acroform   |    130 |     8 |
| Form 13.1    | Financial Statement (Property and Support)         | financial          | acroform   |    319 |    10 |
| Form 13B     | Net Family Property Statement                      | financial          | acroform   |    193 |     3 |
| Form 14      | Notice of Motion                                   | motion             | acroform   |     16 |     2 |
| Form 14A     | Affidavit (Motion)                                 | affidavit          | acroform   |     23 |     2 |
| Form 14B     | Motion Form                                        | motion             | acroform   |     26 |     3 |
| Form 14C     | Confirmation of Motion                             | motion             | acroform   |     43 |     2 |
| Form 15      | Motion to Change                                   | motion-to-change   | acroform   |    140 |     8 |
| Form 15B     | Response to Motion to Change                       | motion-to-change   | acroform   |    118 |     7 |
| Form 15C     | Consent Motion to Change                           | motion-to-change   | acroform   |    157 |     5 |
| Form 17      | Conference Notice                                  | conference         | acroform   |     21 |     1 |
| Form 17E     | Trial Management Conference Brief                  | conference         | acroform   |    142 |     5 |
| Form 17F     | Confirmation of Conference                         | conference         | acroform   |     49 |     2 |
| Form 23C     | Affidavit (Divorce)                                | divorce            | acroform   |    112 |     6 |
| Form 25      | Order (General)                                    | order              | acroform   |     17 |     2 |
| Form 25A     | Divorce Order                                      | divorce            | acroform   |     25 |     2 |
| Form 25F     | Support Order                                      | order              | acroform   |     32 |     2 |
| Form 25G     | Restraining Order                                  | order              | acroform   |     36 |     2 |
| Form 30A     | Request for Default Hearing                        | enforcement        | acroform   |     18 |     1 |
| Form 35.1    | Affidavit in Support of Claim re Parenting         | parenting          | acroform   |    241 |     8 |
| Form 36      | Affidavit for Divorce                              | divorce            | acroform   |     76 |     4 |
| Form 36B     | Certificate of Divorce                             | divorce            | acroform   |     18 |     1 |
| Form 4       | Affidavit (General)                                | affidavit          | acroform   |     18 |     2 |
| Form 6B      | Affidavit of Service                               | service            | acroform   |     96 |     3 |
| Form 8       | Application (General)                              | application        | acroform   |    156 |     6 |

---

## PDF Type Legend

| Type | Meaning | Fill method |
|---|---|---|
| `acroform` | Standard AcroForm with named fields | `_write_pdf()` — matches by `/T` field name |
| `livecycle` | Adobe LiveCycle AcroForm with dotted-path field names | `_write_pdf_lc()` — walks `/Parent` chain to reconstruct full path |

---

## Fill Strategy Notes

### Standard AcroForm (`_write_pdf`)
Forms 4, 8, 10, 13, 13.1, 14, 14A, 14B, 14C, 15, 15B, 15C, 17, 17E, 17F, 23C, 25, 35.1, 36  
Fields are matched by the `/T` key on each widget annotation.

### LiveCycle AcroForm (`_write_pdf_lc`)
Forms 6B, 13B, 25A, 25F, 25G, 30A, 36B  
Field widgets only store the last path segment in `/T` (e.g. `courtFileNumber[0]`).  
`_write_pdf_lc` walks each widget's `/Parent` chain to reconstruct the full dotted path  
(e.g. `form1[0].page1[0].body[0].courtDetails[0].courtFileNumber[0]`) before matching.

---

## Known Gaps

1. **Marketing claim vs reality**: heartandpage.ca says "All 35 Ontario court forms". Backend has 26 forms with fill functions. Gap of 9 forms is aspirational — forms either not yet wired or lower-priority forms (Forms 25B, 25C, 25D, 25E, 26B, 27, 28, 29, 30). Track as future backlog items.

2. **Registry doc vs backend**: `docs/forms/registry.md` listed 20 forms prior to this audit. This file (`forms.json` + `FORM_INVENTORY.md`) supersedes that list.

3. **Form 15A**: Retired December 2020. No fill function written. Should not appear in any user-facing form selector.

---

## Next Actions

- [ ] Decide whether to add the 9 remaining forms or update marketing copy to reflect 26
- [ ] Wire `forms.json` as the authoritative source for the form selector in the app
- [ ] Add `version` and `last_verified_at` fields to each registry entry (feeds the weekly rule monitor)
