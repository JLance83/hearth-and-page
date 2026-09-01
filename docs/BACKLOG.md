# Hearth & Page Backlog

Post-launch work that is intentionally deferred. Each item has a clear
scope, rationale, and rough size. Add new items at the top.

---

## Form 35.1 criminal-history repeatable-group rebuild

**Scope:** Replace the four free-text criminal-history questions on Form
35.1 (Q4-Q7 in the wizard's `f351_history` step) with a repeatable-group
UI that matches the canonical schema in `form-engine/ON/form35_1-schema.json`.

**Rationale:** The canonical schema — designed earlier in the project —
uses a repeatable-group with per-offence fields (description, date,
outcome dropdown, sentence, "involved children or violence?" flag). The
outcome dropdown includes: Convicted, Acquitted, Withdrawn/stayed,
Absolute discharge, Conditional discharge, Pending, Pardon received.

The live wizard bundle instead has four free-text textareas (Q4
"Previous family court cases", Q5 "Civil protection", Q6 "Criminal
offences you've been found guilty of", Q7 "Criminal charges you are
currently facing"). This forces users into a false choice for edge
cases like conditional discharges, withdrawn charges, and acquittals
that aren't strictly "guilty" but that judges still want to see.

**Interim mitigation (shipped 2026-09-01):** Added Q6.5
`criminalOtherInvolvement` free-text field as an escape hatch, plus
tooltip explaining conditional discharges and listing all the
edge-case categories.

**Deferred because:** Rebuilding Q4-Q7 as repeatable-groups requires
- Building/verifying a repeatable-group renderer in the wizard (not
  currently present in the `Su` field type set)
- Migrating existing users' free-text answers to the structured shape
  (or a hybrid old-shape/new-shape rendering path)
- Mapping the new structured fields into the Form 35.1 PDF template
  (currently the wizard's Q6 text isn't even written to the PDF — see
  `fill_form35_1` in `fill_pdf.py`)
- Updating the Answers review tab to render the structured data

**Size:** L (~1 week focused work). Not launch-blocking.

**Owner:** TBD post-launch.

---

## Form 35.1 free-text answers not written to PDF

**Scope:** The `fill_form35_1` handler in `fill_pdf.py` currently only
fills header fields (name, DOB, city, court address) and a small set of
checkboxes. It does NOT write the wizard's Q4-Q7 criminal-history, Q8
violence-history, Q11 caregiving-history, or Q12 parenting-plan
answers into the actual Form 35.1 PDF.

Those answers ARE stored in Supabase (visible on the Answers review
tab) but do not reach the affidavit that gets filed with the court.

**Rationale for fixing:** If a user files the generated PDF as-is, the
court sees a mostly empty affidavit. This is a launch-critical gap for
anyone actually filing Form 35.1, though most users appear to be
generating other forms (Form 8, 13, 14A) and may not have hit this yet.

**Size:** M (~2-3 days). Field-name mapping between wizard keys and
the official PDF's AcroForm text fields.

**Priority:** Verify current launch scope — if any early users are
supposed to file Form 35.1, this becomes P0.

---

## Downgraded-Plus one-time file download exception (Option Y)

**Scope:** Allow users who were Plus but downgraded to Standard to
download their own previously-uploaded files ONE time each, so they
aren't held hostage over docs they uploaded.

**Rationale:** Currently strict Option X — no upload/download/preview
after downgrade until they upgrade back. User (Aug 31 2026) chose
Option X for now but flagged Option Y as "possible in the future".

**Size:** S (~1 day). Backend needs a `first_downloaded_at` timestamp
per document; middleware allows GET download if either (a) currently
Plus, or (b) downgraded and `first_downloaded_at` is null.

**Priority:** Post-launch, based on user support requests.
