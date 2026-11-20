# Bundle Patches

This document is the human-readable inventory of every fix that lives in the
compiled frontend bundle (`dist/public/assets/index-CNjoTsGP.js` and
`dist/public/assets/hp-patches.js`) instead of in the frontend source .tsx
files.

## Why patches live in the bundle

The frontend source (React `.tsx` files) is not being rebuilt from this
repository — the compiled `dist/` directory was built once and committed
directly. Subsequent bug fixes have been applied as targeted string-replace
edits to the compiled bundle, which is faster than a full rebuild and matches
how the repo has been maintained since v3.6.0.

## Why this is a risk

If anyone ever runs `npm run build` (once a build pipeline is wired up),
Vite will regenerate the bundle from scratch and **silently drop every patch
in this list**. The rebuilt app would ship with old bugs and neither the
maintainer nor the user would notice until the affected feature was tested.

To prevent that, `scripts/check-bundle-patches.mjs` is registered as the
`postbuild` npm script and verifies every sentinel in this inventory is still
present in the bundle after a build. Any missing patch fails the build.

You can also run the check manually at any time:

```
npm run check-bundle
```

## Patch inventory

Each patch below has a **sentinel** — a distinctive substring that must be
present in the compiled bundle for the patch to be considered active. When
you add a new bundle patch, add its entry here **and** in the `PATCHES`
array in `scripts/check-bundle-patches.mjs`.

When you port a patch back to source `.tsx` and rebuild cleanly, remove its
entry from both files.

---

### 1. `bc84024` — same-origin API base URL (Batch 1b)

**Problem:** The client bundle hardcoded
`IC = "https://api-production-2334.up.railway.app"` as the API base URL.
Fetches from `app.hearthandpage.ca` to that URL were treated as third-party
by browsers, so the `hp_session` HttpOnly cookie was silently dropped and
users appeared logged out.

**Fix:** Changed `IC = ""` (empty string). All fetches now resolve to
`/api/...` on whatever host the SPA is loaded from, keeping the cookie
first-party. The same change was made to `hp-patches.js` (`var _RW = ''`).

**Sentinel (index bundle):** `const IC="",Dg=IC`
**Sentinel (hp-patches.js):** `var _RW = '';`

---

### 2. `e175ba7` — PDF & wizard content fixes (Batch 3)

**Problem:** Form 10 template date and other PDF content fixes.

**Fix (this sentinel covers the Form 10 date fix):** Form 10 template date
string updated to `FLR 8 (June 13, 2025)`.

**Sentinel:** `FLR 8 (June 13, 2025)`

---

### 3. `313444b` — CAD Stripe Price IDs (Batch 2b)

**Problem:** Bundle hardcoded USD Stripe Price IDs after we switched the
Stripe account to CAD pricing. Users saw the wrong prices in checkout.

**Fix:** Replaced USD Price IDs with new CAD Price IDs whose IDs start with
`price_1U4j`.

**Sentinel:** `price_1U4j`

---

### 4. `55a0385` — save-tab toast + longer green state (BUG-WIZARD-SAVE-FEEDBACK-01)

**Problem:** Users clicked Continue and saw "nothing saved" — the save was
actually completing (verified in Supabase) but the visual feedback was
invisibly brief (600 ms green button, no toast).

**Fix:** Extended the green "Saved — moving on…" state to 1800 ms and added
a Radix toast `{title:"Saved",description:"Your answers are safe."}` from the
same handler so users get an unambiguous confirmation.

**Sentinel:** `Your answers are safe.`

---

### 5. `ff9a3cc` — email button propagates caseId + formKey (BUG-EMAIL-01)

**Problem:** "Email me this PDF" always failed with
`404 /api/cases/1/pdf-link/form8`. The bundle's Review Checkboxes modal has
correct `caseId` and `formKey` in its props but never told `hp-patches.js`
about them. `hp-patches.js` tried to read them from `window.location.hash`,
but this app uses BrowserRouter so the hash is always empty, falling back to
`caseId=1` and `formKey='form8'` (the wrong case for every user).

**Fix:** Wrap the modal's `window.__emailPDF(...)` call in a comma expression
that also sets `window.__hp_currentCaseId = r` and
`window.__hp_currentFormKey = n` (from the modal's local props). `hp-patches.js`
already reads those globals correctly.

**Sentinel:** `__hp_currentCaseId=r,window.__hp_currentFormKey=n,window.__emailPDF`

---

### 6. `27b6652` — Form 8 claim keys routed to section 4 (BUG-CHECKBOX-GATE-01, part 1)

**Problem:** The Review Checkboxes modal grouped Form 8 claim checkboxes
(`custody`, `child_support`, `spousal_support`, `property`,
`restraining_order`, `divorce`, `other_orders`) under section 1 "Case
Scheduling" instead of section 4 "What You're Asking the Court For (Claims)".
The frontend groups checkboxes by looking up `TO[formType][name]` with fallback
to the checkbox's `page` field; every claim key has `page: 1` in
`CHECKBOX_DEFS` (`dist/index.cjs`), so they all fell into section 1.

**Fix:** Extended the `TO['form8']` override map to route all seven claim keys
to section 4.

**Sentinel:** `custody:4,child_support:4`

---

### 7. `27b6652` — checkbox label fallback to backend label (BUG-CHECKBOX-GATE-01, part 2)

**Problem:** The Review Checkboxes modal rendered raw snake_case keys
(`custody`, `child_support`, etc.) because it looked up labels via
`EO(name) = Dk[name]?.label ?? name`, and `Dk` only contained Form 13
Yes/No rental-income keys. Every Form 8 claim key fell through to the raw
name.

**Fix:** The backend already includes a proper `label` field on each
checkbox in the `pdf-checkboxes` response (`dist/index.cjs` line ~1214).
Changed the label expression from `fe = EO(Y.name)` to
`fe = Y.label || EO(Y.name)` so the backend-provided label wins when
present, and the static `Dk` map remains a fallback for legacy code paths.

**Sentinel:** `fe=Y.label||EO(Y.name)`

---

### 8. `58ed91f` — hide floating FABs on mobile (BUG-MOBILE-FAB-OVERLAP-01)

**Problem:** The "Am I Ready?" and "H&P Tools" floating buttons use
`position: fixed; bottom: 140px/196px; right: 24px` so they stay glued to
the viewport. On desktop the content is a centered column with side margin,
so the FABs don't overlap. On mobile the content spans the full width, so
the FABs sit permanently on top of answer buttons, links, info icons, and
footer text on every wizard page.

**Fix (Option A, mobile-hide):** Add a `@media (max-width:768px)` block
for each FAB in `hp-patches.js` that sets `display:none !important`.
Mobile users no longer see the FABs; desktop behavior is unchanged.

**Follow-up planned (Option C):** Change `position:fixed` to `position:static`
on mobile so the FABs scroll with content at the bottom of each page —
preserves the features on phone. Deferred until the maintainer is back at
their Mac and can test more thoroughly.

**Sentinel (Ready FAB):** `@media (max-width:768px){#hp-ready-fab{display:none !important;}}`
**Sentinel (Tools FAB):** `@media (max-width:768px){#hp-tools-fab{display:none !important;}}`

---

### FIX-CASE-ALL-FORMS — Case wizard shows every form on the case (Nov 5 2026)

**Problem:** `c1(caseType)` built the question screens from a short list of
fixed form combinations and returned early. A case with any other mix lost
forms from its screens. Example: a case with Forms 8, 35.1, 13, 6B, 14A, 36,
14C and 15 showed only Form 15 and Form 35.1, so the user could not see or
edit their Form 8, 13 or 36 answers. Saved answers were never lost.

**Fix:** Inside `c1`, after the one-form returns, if the case has 2+ forms and
is not exactly one of the combinations that already worked, build the list by
stacking every form's screens in a fixed order (8, 8A, 10, 10A, 35.1, 13,
13.1, 13B, 15, 15B-D, 14, 14A-C, 36, 36A, 6B, 6, 6C, then the rest). Shared
screens appear once, each form's empty review screen is dropped, and one
"Review and confirm" screen ends the list. Form 35.1 identity/children screens
are skipped when another form already asks those questions (same as the
existing combinations). Cases that already worked are unchanged.

**Sentinel:** `/*FIX-CASE-ALL-FORMS*/{const __hpK=`

---

### FIX-COMPLETE-EDIT-BTN — "Edit answers" on finished case cards (Nov 5 2026)

**Problem:** A finished case's dashboard card showed only "Download PDF".
To change an answer (for example, when a court or lawyer sends a form back),
the user had to open the download page and find "Back to questions".

**Fix:** The finished-case branch of the card now shows two stacked,
equal-width buttons: "Edit answers" (opens `/case/:id/wizard`) and
"Download PDF" (unchanged). In-progress cards are unchanged ("Continue").
Uses only classes already in the prebuilt CSS (flex-col, items-stretch,
w-full).

**Sentinel:** `"data-hp-fix":"FIX-COMPLETE-EDIT-BTN"`

---

### FIX-FIELD-ID-KEY — 24 forms could not save answers (Nov 5 2026)

**Problem:** 357 questions on 24 forms (20.2, 22, 22A, 25F, 25G, 25H, 26,
26A, 26C, 27, 27A, 27B, 27C, 29, 29A-F, 30, 30A, 36A, 39) name themselves
with `id` instead of `key`. The question screens read `key`, so every box on
a screen shared one blank name: typing in one box filled them all, and the
save request had no fieldKey, which the server rejects (400). No real case
used these forms at the time (DB check), so no answers were lost.

**Fix:** The first time `c1` runs, it copies `id` to `key` on any question in
those 24 step lists that has no `key`. Nothing else changes. Checked: no
duplicates, no nested fields, no conditions on these questions.

**Not fixed here:** the PDFs for 25F, 25G, 30A and 36A read different names
than these questions use (about 1 of 12-17 answers print), and the other 20
forms have no PDF template in the app. Tracked separately.

**Sentinel:** `function c1(t){/*FIX-FIELD-ID-KEY*/c1.__hpN||`

---

### FIX-F15-CASE-ROLE — Form 15 asks your role in the original case (Nov 6 2026)

**Problem:** On a motion to change, page 1 of Form 15 keeps the Applicant
and Respondent from the original case, whoever asks for the change (Family
Law Rules, O. Reg. 114/99). The app never saved which one the user was, so
the page 1 party boxes could not be filled correctly.

**Fix:** A new first screen in the Form 15 step list (`Nh`), id `case_role`,
with one required question `caseRole`: `applicant`, `respondent`, or
`agreement` (filed agreement, no court case: the person asking is the
Applicant). It saves as section `case_role`, key `caseRole`; the PDF rows
see it as `case_role`. The step id is not Form 15 specific, so later forms
can reuse the same screen and the stacking in `c1` shows it once. Nothing
prints from it yet (that is the next filler change).

**Sentinel:** `const Nh=[{id:"case_role",title:"Your role in the case"`

---

### FIX-F15-AGREEMENT-WARN — Form 15 warns about non-support changes to an agreement (Nov 6 2026)

**Problem:** Form 15 says "You can only use this form to change support
terms in an agreement that has been filed" with the court. The app let a
user pick "A support agreement" and then ask to change decision-making,
parenting time or contact with no warning. Ontario guides say other terms
in an agreement are changed by starting a family law case (Application,
Form 8): https://stepstojustice.ca/family-flowcharts/applicant/change-your-order-or-separation-agreement/

**Fix:** One more entry in the wizard's existing amber notice list (the same
list as "Form 35.1 is required for parenting claims"). It shows on Form 15
screens 3 and 4 (`f15_existing_order`, `f15_changes_requested`) when
`existingDocType` is `agreement` and `changeTypes` includes
`decision_making`, `parenting_time` or `contact`, naming the ones picked.
"Other" does not trigger it (it may be a support change). It is advice
only: it does not block Continue or change any answer.

**Sentinel:** `/*FIX-F15-AGREEMENT-WARN*/u.f15_existing_order?.existingDocType==="agreement"`

---

### FIX-F15-RECALC-DATE — Form 15 asks the recalculation date (Nov 9 2026)

**Problem:** Form 15 page 1 says "the order/agreement recalculated by the
online Child Support Service on ___". The app let a user pick "An amount
recalculated by the online Child Support Service" but never asked for the
date, so that line was always blank.

**Fix:** One new date question on the Form 15 screen `f15_existing_order`,
right after "Date of the agreement": `recalculationDate`, "Date of the
recalculation", shown only when `existingDocType` is `recalculated`. Not
required (blank stays blank). It saves as section `f15_existing_order`,
key `recalculationDate`; the PDF rows see it as
`f15_existing_order_recalculation_date`. The filler prints it on page 1 in
"Date of order/agreement" only when the recalculated box is ticked.

**Sentinel:** `/*FIX-F15-RECALC-DATE*/{key:"recalculationDate",type:"date",label:"Date of the recalculation"`

---

### FIX-SHOWIF-CHECKBOXES — follow-up questions work when several boxes are ticked (Nov 9 2026)

**Problem:** A question can be set to show only when another answer on the
same screen has a certain value (`showIf`). Checkbox answers are saved as a
comma list, e.g. `child_support_special,other`, but the rule compared the
whole list to one value. So a follow-up only appeared when its box was the
ONLY box ticked. Example: Form 15 "Types of special / extraordinary
expenses" vanished as soon as a second change was also ticked. 12
follow-ups on Forms 15, 15C, 15D, 12, 17, 17C and 17E were affected.

**Fix:** In both places the rule is used (drawing the screen, and the
"required answers missing" check), a question now shows when the answer
equals the value OR the comma list contains it. Yes/no and pick-one answers
never contain commas, so they behave exactly as before (checked: every
`showIf` in the bundle points at a yes/no, pick-one or checkbox question).

**Not fixed here:** 18 questions point at an answer on a different screen
and so never show (Form 15 `yourCircumstancesChildSupport`; 17 on Form 23C
`f23c_claims` pointing at `orderSought`). Separate steps. Both are now fixed
(FIX-F15-17D-SHOWIF, FIX-F23C-ORDERS).

**Sentinels:** `/*FIX-SHOWIF-CHECKBOXES*/if(!_||!S.some(x=>x===_||String(_).split(",").includes(x)))return null}`
and `if(!Ge||!gt.some(x=>x===Ge||String(Ge).split(",").includes(x)))return!1}`

---

### FIX-F15-INCOME-TABLE — Form 15 asks the item 9 income table (Nov 9 2026)

**Problem:** Form 15 page 2 item 9 asks, if you are changing support, for
your income and the other party's income (if known) for the past 3 years,
with sources. The app never asked, so the table was always blank.

**Fix:** 15 optional questions at the end of the Form 15 screen
`f15_changes_requested`, after "Types of special / extraordinary
expenses". For each year 1-3: `incomeYear{n}`, `myIncome{n}`,
`myIncomeSources{n}`, `otherIncome{n}`, `otherIncomeSources{n}`. Each has
`showIf: {key: "changeTypes", equals: ["child_support_table",
"child_support_special", "spousal_support"]}` so they show only when a
support change is ticked (needs FIX-SHOWIF-CHECKBOXES for combinations).
Year 1's tip quotes the form's instruction (total income, line 150 - now
line 15000 - of the tax return). PDF rows see them as
`f15_changes_requested_income_year1`, `..._my_income1`, etc.

**Sentinel:** `/*FIX-F15-INCOME-TABLE*/{key:"incomeYear1",type:"text"`

---

### FIX-F15-17D-SHOWIF — Form 15 item 17d question now shows (Nov 9 2026)

**Problem:** Form 15 item 17d ("your circumstances and the child's
circumstances that support this request") belongs to item 17, which
applies only when the support change should start before today. The
question `yourCircumstancesChildSupport` on screen `f15_circumstances`
had `showIf: {key: "changeTypes", ...}`, but `changeTypes` is on a
different screen (`f15_changes_requested`). The screen only looks up
answers on itself, so the question never showed for anyone and 17d was
always blank.

**Fix:** `showIf` is now `{key: "changeStartWhen", equals:
"before_today"}` (same screen, same rule the PDF filler already uses for
items 17a-d). The question also moved to the end of the screen, after
"Why didn't you ask the court to change support sooner?", so it appears
below the answer that reveals it and in the form's order (17c then 17d).
Saved answers keep the same key.

**Sentinel:** `label:"Your circumstances and the children's circumstances that support a change to child support",showIf:{key:"changeStartWhen",equals:"before_today"}` (from the label on, since FIX-FIT-WARN added `fit` after `type`)

---

### FIX-SHOWIF-NESTED — follow-ups of hidden questions hide too (Nov 9 2026)

**Problem:** a follow-up question only checked the one answer it depends
on. If that question was itself a follow-up and got hidden, its saved
answer stayed, so the next follow-up kept showing on its own. Example
(Form 15C): tick child support, choose "Less than the table amount",
then untick child support. "The agreed child support amount is" hides,
but "Reasons why the amount is below the guideline table amount" stayed
on screen. Same on Form 6C ("Describe the other special service
method"). Found while adding FIX-F15-CHILD-SUPPORT-YN, which has the
same shape.

**Fix:** one shared helper `__hpShowOk(field, screenFields, answers)`,
added near the top of the bundle (after the comment header). It does the
FIX-SHOWIF-CHECKBOXES match (exact answer, or one item of a comma list),
then, if the question it depends on is on the same screen and has its
own `showIf`, checks that question too (up to 5 levels). Answers from
another screen keep the old one-level check. Both places that decide
visibility use it: the screen render (`e.map(g=>...)`) and the
required-answers check (`Pe.fields.filter(...)`). The FIX-SHOWIF-CHECKBOXES
guard entries now point at the helper and the required-check call.

Hidden answers are not deleted, so ticking the box again brings the
answer back. The PDF filler gates these answers on its own.

**Sentinel:** `if(g.showIf){/*FIX-SHOWIF-NESTED*/if(!__hpShowOk(g,e,r))return null}`

---

### FIX-F15-CHILD-SUPPORT-YN — Form 15 asks which children the support change is for (Nov 9 2026)

**Problem:** Form 15 page 2 lists each child with a last column "Change
of support being requested, yes or no". The app never asked, so it was
always blank.

**Fix (plan decision D3-A):** two optional questions on screen
`f15_changes_requested`, after "Types of special / extraordinary
expenses" and before the income table:
- `supportAllChildren` (yes/no): "Is the child support change for every
  child listed in this case?" `showIf: {key: "changeTypes", equals:
  ["child_support_table", "child_support_special"]}`.
- `supportChildrenNames` (text box): "Which children ... one per line,
  exactly as you entered it". `showIf: {key: "supportAllChildren",
  equals: "no"}`. Hides when child support is unticked thanks to
  FIX-SHOWIF-NESTED.

PDF rows see them as `f15_changes_requested_support_all_children` and
`f15_changes_requested_support_children_names`. The filler only marks
YES/NO when names match exactly (see the FIX-F15-CHILD-SUPPORT-YN block
in `dist/fill_pdf.py`).

**Sentinel:** `/*FIX-F15-CHILD-SUPPORT-YN*/{key:"supportAllChildren",type:"yesno"`

---

### FIX-FIT-WARN — amber note when an answer won't fit its Form 15 box (Nov 9 2026)

**Problem (plan decision D5):** the PDF filler shrinks Form 15 answers
from 10pt down to 7pt to fit their boxes, but an answer too long even at
7pt gets cut off on the PDF. The user was never told.

**Fix:** an advice-only amber note under the answer, shown while typing.
It never blocks Continue and never changes the answer.
- Helpers near the top of the bundle (before `__hpShowOk`):
  `__hpW` (Helvetica width, same letter-width table as `_HELV_W` in
  `dist/fill_pdf.py`), `__hpLines` (word wrap, a line-by-line copy of
  `_wrapped_line_count`), `__hpFitMsg(field, value)` and
  `__hpFitNote(s, field, value)`.
- A field opts in with `fit`:
  - `{w, h}`: big box, wrapped at 7pt (same test as `_wrap_fit_pt`).
  - `{w, rows: 7}`: page 3 table; one row per typed line, lines 7+
    joined with "; " into row 7 (same as `_f15_rows`), each row one line.
  - `{w}`: one-line box. `money: 1` formats numbers as 1,234.56 first
    (same as `_f15_money`).
  Usable width is `(w - 6) * 0.95`, as in the filler.
- Sizes are the real box sizes from `_box_sizes` on
  `dist/public/pdfs/form15.pdf`. 24 Form 15 answers: currentTerms,
  requestedChanges, specialExpensesTypes, otherChangeDetails, the 15
  income table answers (f15_changes_requested), notFollowingDetails,
  changeInCircumstances, otherPartyDifficultDetails, whyNotSoonerDetails,
  yourCircumstancesChildSupport (f15_circumstances). Same-named answers
  on other forms are not touched.
- Note shown under textarea and one-line text answers
  (`data-testid="fit-warn-<key>"`).

**If you change the filler's fitting rule or a template box, update the
matching `fit` sizes here.** Cross-checked against the Python rule on
4,000 random answers: 0 differences.

**Sentinel:** `function __hpFitNote(s,t,e){const m=__hpFitMsg(t,e);`

---

### FIX-F23C-ORDERS — Form 23C claim questions now show (Nov 13 2026)

**Problem:** all 17 questions on the Form 23C "Your claims" screen depend on
"What type of order are you asking for?" (`orderSought`), which was on step 1
(`f23c_identity`). The app only checks answers on the same screen, so none of
the 17 ever showed. The question also allowed only one order, but paragraph 3
of the official form lets you tick several.

**Fix (Form 23C plan, decisions D1 + D2):**
- `orderSought` moved from `f23c_identity` to the top of `f23c_claims`. It is now
  tick boxes ("Which orders are you asking for? (tick all that apply)"):
  decision-making, parenting time, contact, child support, spousal support,
  restraining order, other. `otherOrderDetails` moved with it.
  Spousal support is a tick option here and unlocks paragraph 14. On the PDF, child
  and spousal support both go to the paragraph 3 "support for" line.
- Paragraph 7 (`respondentParentingTimeYesNo` + reasons) now shows for decision-making
  or parenting time, not only decision-making. The options read "is" or "is not" in the children's best interests.
- Paragraph 8 (`parentingTimeSchedule`) shows for either one and uses the form's
  three choices: `reasonable`, `reasonable_plus`, `terms`. The old "supervised" choice isn't on the form.
  `parentingTimeDetails` shows only for `reasonable_plus` or `terms`.
- The questions are reordered to match the form (paragraphs 5, 6, 7, 8).

No saved 23C answers existed (DB check), so nothing needed migrating. The PDF
filler doesn't read these answers yet (plan bricks 2–7). After this change no form in the
bundle has a `showIf` that points at another screen.

**Sentinel:** `/*FIX-F23C-ORDERS*/{key:"orderSought",type:"checkboxes",label:"Which orders are you asking for? (tick all that apply)"`

---

### FIX-F23C-FIT-WARN — too-long notes on Form 23C answers (Nov 13 2026)

**Problem:** Form 23C answers now print on the PDF (FIX-F23C-PAGE1-6 and
FIX-F23C-REASONS), but nothing told people when an answer was too long
for its box.

**Fix:** the same amber note as FIX-FIT-WARN (no new code, only `fit` sizes
taken from the official template's box sizes). Nine Form 23C questions:
- Big boxes `{w,h}`: decisionMakingReasons (para 5), parentingTimeReasons (6),
  respondentParentingTimeReasons (7), contactReasons (9),
  respondentIncomeReasons (13), spousalSupportReasons (14),
  notServedReasons (16), otherIssues (page 6).
- One-line boxes `{w}`: otherOrderDetails (para 3 "other"), respondentIncome
  (para 13 amount, printed as typed so no money formatting).

Checked: the note and the filler's own fit check (`_wrap_fit_pt`, 7pt
smallest) agree on 3,600 random answers across the 8 big boxes (0
mismatches). Para 10 contact terms gets its size in brick 5.

**Sentinel:** `{key:"decisionMakingReasons",type:"textarea",fit:{w:497.29,h:112.94}`

---

### FIX-F23C-PT-TERMS — Form 23C para 8 parenting-time terms (Nov 13 2026)

**Problem:** para 8 on the official form is a list of fixed terms with
blanks (every other weekend from __ p.m. Friday to __ p.m. Sunday starting
__; alternate spring breaks starting __; __ weeks of summer; half the
winter break __ to __ shared as follows __; special days __; other __).
The app only asked one free-text "details" box, which fits none of them.

**Fix:** in `f23c_claims`, when the schedule is "including but not limited
to the terms below" or "on the following terms":
- `ptTerms` tick boxes: weekends, spring_break, summer, winter_break,
  special_days, other.
- Each term's blanks show only when it's ticked: `ptWeekendFrom` /
  `ptWeekendUntil` (p.m. time picker, 12:00 to 11:30 in half hours, since the
  form prints "p.m."), `ptWeekendStart` (date), `ptSpringYear`,
  `ptSummerWeeks` (number), `ptWinterStart` / `ptWinterEnd` (dates),
  `ptWinterShared`, `ptSpecialDays`.
- The old `parentingTimeDetails` key is kept as the "Other terms" answer
  (no answers lost, no duplicate question).
- Too-long notes (`fit`) on the three big boxes and the Other box.

The filler side is a separate commit.

**Sentinel:** `/*FIX-F23C-PT-TERMS*/{key:"ptTerms",type:"checkboxes"`

---

### FIX-F23C-CONTACT-TYPE — Form 23C para 10 contact order type (Nov 13 2026)

**Problem:** para 10 on the official form has three choices (reasonable
contact on reasonable notice; reasonable, including but not limited to the
terms below; on the following terms) and one big terms box. The app only
asked a free-text schedule, with no choice.

**Fix:** in `f23c_claims`, when Contact is ticked:
- New `contactOrderType` select (reasonable / reasonable_plus / terms).
- `contactSchedule` (same key, so saved answers are kept) now shows only for
  reasonable_plus or terms, relabelled to match the form, with a `fit`
  size of the page 3 terms box (481.32 x 366.61).

The filler side is a separate commit.

**Sentinel:** `/*FIX-F23C-CONTACT-TYPE*/{key:"contactOrderType",type:"select"`

---

### FIX-F23C-INCOME-SRC — Form 23C para 12 income sources (Nov 13 2026)

**Problem:** para 12 on the official form has four income-source tick
boxes, three with a text blank (employer name and address; self-employment
business; other). The app showed the employer and business questions
whenever child support was ticked, even if that source wasn't, and never
asked for the "other" source.

**Fix:** in `f23c_claims`:
- `respondentEmployer` shows only when Employment is ticked;
  `respondentBusiness` only when Self-employment is ticked.
- New `respondentOtherIncomeSource` (text) shows when Other is ticked.
- One-line `fit` sizes from the template for all three, labels match the
  form, and the income-source question gets a tooltip.
- `respondentIncome` moved below the sources so the screen follows the
  form (para 12, then para 13).

The filler side is a separate commit.

**Sentinel:** `{key:"respondentOtherIncomeSource",type:"text",fit:{w:481.33}` (plus `/*FIX-F23C-INCOME-SRC*/` before `respondentIncomeSource`)

---

### FIX-F23C-RO-TERMS — Form 23C para 15 restraining order terms (Nov 13 2026)

**Problem:** para 15 on the official form sets out the restraining order
terms: (a) no contact with listed people (5 name/birth date rows) with
four exceptions, (b) stay a set distance (metres/yards/feet) from
locations, with optional exception conditions, (c) additional terms, then
the reasons. The app only asked the restrained person's name/DOB and the
reasons.

**Fix:** in `f23c_claims`, when Restraining order is ticked:
- `roTerms` tick boxes: no_contact, distance, additional.
- (a) `roProtect` (me / children / other). Names and birth dates for "me"
  and "the children" come from the main case (filler side), so nothing is
  typed twice. "Other" asks `roOtherName1/Dob1`, `roOtherName2/Dob2`.
  `roContactExceptions` (through_person, parenting_time, counsel,
  counsel_ocl), with `roThroughPerson` and `roPtWhen` for the first two
  (the children for the parenting-time exception come from the case).
- (b) `roDistance`, `roDistanceUnit` (metres/yards/feet), `roLocations`,
  `roDistanceConditions` (optional).
- (c) `roAdditionalTerms`.
- `fit` sizes from the template on every text answer, including
  `restrainingReasons`.

The filler side is a separate commit. The old restrainedPersonName/Dob
duplicates are removed in brick 8.

**Sentinel:** `/*FIX-F23C-RO-TERMS*/{key:"roTerms",type:"checkboxes"`

---

### FIX-F23C-NO-DUPES — Form 23C duplicate questions removed (Nov 13 2026)

**Problem:** the Form 23C screens still asked things the main case already
answers: your full name, municipality, province, number of children, a
whole "Children" screen (3 children x name/age/birth date/city/living
with), and the restrained person's name and birth date. The filler
already prints all of these from the main case (FIX-F23C-PAGE1-6 and
FIX-F23C-RO-FILL), so the duplicates were never printed and only made
the user type things twice (plan decision D3).

**Fix:**
- `f23c_identity`: removed `deponentName`, `municipality`, `province`,
  `numberOfChildren`. Kept the relationship questions (they only fill a
  gap when the case has no marriage/separation date). Title is now "Your
  relationship to the Respondent"; the intro says name, city and children
  come from the case answers.
- Removed the `f23c_children` screen (pill `pill-f23c_children`).
- `f23c_claims`: removed `restrainedPersonName` / `restrainedPersonDob`
  (the respondent from the main case is the person restrained).
- Subtitles renumbered to "Step 1/2/3 of 3".

Old saved answers under the removed keys (none exist today) still work as
gap-fill in the filler; no filler change.

**Sentinel:** `/*FIX-F23C-NO-DUPES*/{key:"relationshipStatus",type:"select"`

---

### FIX-F15-NO-DUPES-1 — Form 15 step 1 identity questions removed (Nov 13 2026)

**Problem:** Form 15 step 1 ("Your information") asked again for your
full name, address, city, province, postal code, phone, email and birth
date (5 of them required). The main case "About you" screen already asks
all of these. Since FIX-F15-MAIN-FIRST (5358e41) the PDF prints the main
case answer first, so editing the Form 15 copy did nothing and was
misleading. Form 15 duplicates plan brick 2 (Josh approved D1).

**Fix:** in `f15_requesting_party`, removed `fullName`, `address`, `city`,
`province`, `postalCode`, `phone`, `email` and `dob`. Kept `hasLawyer`
and the four lawyer questions (the main case never asks about your
lawyer). The step is retitled "Your lawyer for this motion", and the
intro says name, address, phone, email and birth date come from the case
answers. Old saved answers under the removed keys still fill gaps in the
filler. No filler change.

**Sentinel:** `/*FIX-F15-NO-DUPES-1*/{key:"hasLawyer",type:"yesno"`

---

### FIX-F15-NO-DUPES-2 — Form 15 step 2 other-party duplicates removed (Nov 13 2026)

**Problem:** Form 15 step 2 asked again for the other party's name
(required), address, phone and birth date, and whether they have a
lawyer with the lawyer's name and phone. The main case "About the other
person" screen already asks all of these. The PDF prints the main case
first (FIX-F15-MAIN-FIRST, FIX-F15-THEIR-LAWYER). Form 15 duplicates
plan brick 3 (Josh D1, D2-A).

**Fix:** `f15_responding_party` now asks only what the main case
doesn't:
- `email` ("Their email (if you know it)").
- `lawyerAddress` and `lawyerEmail`, labelled "only if they have a
  lawyer". Show/hide rules can only see answers on the same screen, and
  "has a lawyer" now lives in the main case, so these are always shown
  but optional. The filler prints them only when the main case says
  they have a lawyer.

Removed: `fullName`, `address`, `phone`, `dob`, `hasLawyer`,
`lawyerName`, `lawyerPhone`. The step is retitled "The other party's
email and lawyer", and the intro says the rest comes from the case
answers. Old saved answers still fill gaps in the filler.

**Sentinel:** `/*FIX-F15-NO-DUPES-2*/{key:"email",type:"email"`

---

### FIX-F15-NO-DUPES-3 — Form 15 step 3 marriage, separation and where-you-live duplicates removed (Nov 14 2026)

**Problem:** Form 15 step 3 asked again for the marriage date, the
separation date (required) and the municipality where each party lives.
The main case already asks all of these, and the PDF prints the main
case first (FIX-F15-MAIN-FIRST for the dates, FIX-F15-PLACE-MAIN for
the cities). Form 15 duplicates plan brick 4 (Josh D1, D3-A).

**Fix:** `f15_existing_order` keeps `existingDocType`, `justiceName`,
`orderDate`, `agreementName`, `agreementDate`, `recalculationDate` and
`cohabitationStartDate`. Removed: `marriageDate`, `separationDate`,
`requestingPartyMunicipality`, `respondingPartyMunicipality`. The intro
now says the dates and cities come from the main case answers. Old
saved answers still fill gaps in the filler (marriage date only when the
main case says married; cities follow the strict FIX-F15-PLACE-MAIN
rule).

**Sentinel:** `/*FIX-F15-NO-DUPES-3*/,{key:"cohabitationStartDate"`

---

### FIX-F15-TERMS-EXAMPLE — Form 15 step 4 example without the "Current term" label (Nov 14 2026)

**Problem:** The step 4 example text for `currentTerms` and
`requestedChanges` began each line with "Current term 1:" / "Requested
change 1:", and the tip said "You can list each as a numbered term". The
filler prints each typed line as typed onto its own row (a)-(g) of
page 3 item 11 (FIX-F15-TERMS-TABLE), so a user who copied the example
got "Current term 1: ..." printed inside row (a). Item 11 already labels
the columns, so the prefix is wrong on the form.

**Fix:** Example text only, no filler change (text still prints as
typed, no rewording):
- `currentTerms` example: one term per line, each starting with its
  paragraph number ("Paragraph 4: The Respondent shall pay ..."), no
  "Current term" label. Item 11 itself asks for "the paragraph number of
  each term and the wording of the term exactly as it appears". Tip says
  this and that each line prints on its own row (a) to (g).
- `requestedChanges` example: same, plus "in the same order as the
  current terms". Each example line fits a row at 10pt.

**Sentinel:** `/*FIX-F15-TERMS-EXAMPLE*/{key:"currentTerms",type:"textarea"`

---

### FIX-F351-Q1-NAMES — Form 35.1 Q1 other names asked in combined cases (Nov 14 2026)

**Problem:** When Form 35.1 comes with other forms (for example Form 8 or
Form 15), the "Your identity" screen was skipped so name, birthdate and
city aren't asked twice. That also hid "Other names you've used"
(Q1), which only Form 35.1 asks, so Q1 was always blank.

**Fix:** New helper `__hpQ1(screen, on)`, declared right after the Form
35.1 screen list `Su`. When `on`, the `f351_identity` screen is shown
with only the `otherNames` question, a new title ("Other names you've
used") and an intro saying the name, birthdate and city come from earlier
answers. Applied at all four places that used to skip `f351_identity` in
combined flows (the `__hpP` multi-form loop and the three
`Su.filter(...)` lists). `f351_children` is still skipped (brick 3).
Answers save to the same `f351_identity.otherNames` key as before.
Filler side (`fill_form35_1`): prints the answer on the Q1 line; "none",
"no", "n/a" and similar print "N/A" (the form's own instruction); blank
stays blank; too long goes to the continuation page.

**Sentinel:** `__hpQ1=/*FIX-F351-Q1-NAMES*/(t,on)=>`

---

### FIX-F351-NO-CLIENT-PATCH — Form 35.1 browser PDF patcher turned off (Nov 14 2026)

**Problem:** After the server returned a filled Form 35.1, the browser ran
`window.__patchForm35PDF_real` (in `hp-patches.js`) on every download and
email. It used pdf-lib to:
- rewrite the Q12(a) "address" box with the raw saved answer, putting back
  the "N/A" unit part the filler drops (case 17: "3674 Mark St, N/A, Val
  Caron, ON") and ignoring the filler's text size;
- rewrite the Q12(d) workplace box (untrimmed, filler size ignored);
- try to put the user's own name in every Q11 caregiver row, which is a
  guess. That part did nothing only because its field names use a straight
  apostrophe and the template uses a curly one.

**Fix:** The function returns `null` at once, so the callers keep the
server PDF exactly as filled (they already treat `null` as "no change").
The server filler (`fill_form35_1`) fills these boxes. Cache token for
`hp-patches.js` bumped to `?v=20261114f351np`.

**Sentinel:** `// FIX-F351-NO-CLIENT-PATCH (Nov 14 2026)` in `hp-patches.js`

---

### FIX-F351-Q2-CHILDREN — Form 35.1 Q2 children table questions (Nov 14 2026)

**Problem:** Form 35.1 Q2 needs, for each child, the parents' names and
your relationship to the child. Combined flows skipped the
`f351_children` screen, so those were never asked. With Form 15 or 15C
(no main "Your children" screen) the children were not asked at all, so Q2
was empty.

**Fix:**
- New helper `__hpQ3(screen)`, declared after `__hpQ1`. For
  `f351_children` it returns a short version: title "Children's parents
  and your relationship", `lockCount:1`, and
  `childFields` = only `parents` and `relationship` (taken from `AF`).
- The children component `tR` takes a new `lockCount` prop. When set, the
  count box is replaced by "Children from your earlier answers: N" (the
  count comes from the main children answers, merged in by `z0`). Each
  child card heading now shows the child's name when known ("Child 1 —
  Paeton Lance").
- The wizard passes `Ee.childFields||Ne` and `Ee.lockCount` to `tR`;
  required-field checks use `Pe.childFields||Ne`. Every other children
  screen has no `childFields`, so nothing else changes.
- Flows: `f351_children` is no longer skipped. When the main `children`
  screen is in the flow (Form 8 combinations: the `Be` list and the
  `__hpP` loop when it contains `children`), the short version is shown.
  Otherwise (Form 15 / 15C combinations) the full Form 35.1 children
  screen is shown.

Filler side (`fill_form35_1`): see FILLER_VERSION .49. Name, birthdate and
lives-with come from the main children answers when given, else the Form
35.1 screen; parents and relationship from the Form 35.1 screen. Birthdate
dd/mm/yyyy; age worked out on the day (Toronto date; "N mo" under 1). A
working copy of the template renames the page 1 relationship boxes (they
shared the name `) - child N` with page 2 Q3 boxes) and makes the name,
parents and relationship boxes row-height with wrapping. A cell that still
doesn't fit, and any child after the 5th, goes to the continuation page.

**Sentinel:** `__hpQ3=/*FIX-F351-Q2-CHILDREN*/t=>`

---

### FIX-F351-ROWS + FIX-F351-Q4Q5-ROWS — table questions as rows (Nov 14 2026)

**Problem:** Form 35.1 paragraphs 4 (family court cases) and 5 (civil
protection proceedings) are tables on the form, but the app asked each as
one free-text box, and the filler printed neither.

**Fix (bundle):**
- New field type `rows`, drawn by a new helper `__hpRows` (declared after
  `__hpQ3`). The field has `columns` (each a normal field: key, label,
  type, placeholder), `rowLabel`, `addLabel` and `max` (default 3). It
  shows one card per row ("Case 1", "Case 2", ...). Each cell is drawn by
  the normal single-field renderer `_3` and saved as
  `<key>_<row>_<column>` (row is 0-based). "+ Add another ..." saves
  `<key>_count`; "Remove" (last row, not row 1) clears that row's cells and
  lowers the count. Rows with answers always show, even if the count is
  stale.
- The field-list renderer `ZE` sends `type:"rows"` to `__hpRows`.
- `f351_history`: `familyCases` / `civilProtection` text boxes replaced by
  `familyCasesAny` (Yes/No) + `familyCaseRows` (location, parties,
  children, orders; up to 6) and `civilProtectionAny` (Yes/No) +
  `civilProtectionRows` (location, people, orders; up to 6). Rows show only
  after "Yes".

**Filler side (`fill_form35_1`, FILLER_VERSION .50):** generic table helper
`_f351_fill_tables` driven by `_F351_TABLES`. "No" prints N/A in row 1
Court location. Each cell sized 10pt down to 7pt; a cell that doesn't fit
says "See continuation page" and the whole row goes on the continuation
page, as do rows 4 and up. Old free-text answers (saved before this change,
Yes/No not answered): none-type words print N/A; other text goes on the
continuation page. The template working copy makes the one-line Court
location boxes row-height with wrapping. Continuation items are sorted by
paragraph.

**Sentinels:** `__hpRows=/*FIX-F351-ROWS*/(` and
`/*FIX-F351-Q4Q5-ROWS*/{key:"familyCasesAny"`

---

### FIX-F351-Q6Q7-ROWS — paragraphs 6 and 7 as rows (Nov 14 2026)

**Problem:** Form 35.1 paragraphs 6 (offences found guilty of, no pardon)
and 7 (current charges) are tables on the form; the app asked each as one
free-text box and the PDF left them empty.

**Fix (bundle):** on the `f351_history` screen, `criminalConvictions` is
replaced by `convictionsAny` (Yes/No) + `convictionRows` (charge,
approximate date, sentence; up to 6), and `currentCharges` by
`currentChargesAny` (Yes/No) + `currentChargeRows` (charge, next court
date as a date picker, terms of release; up to 6). Uses the `rows` type
from FIX-F351-ROWS. Question 6.5 (`criminalOtherInvolvement`) is unchanged
except its label now says it prints under Question 6.

**Filler side (FILLER_VERSION .51):** two more `_F351_TABLES` entries.
Next court date prints dd/mm/yyyy. Decision D8: question 6.5 prints in the
paragraph 6 table as "Other involvement: ..." in the Charge box of the next
empty row (none-type answers print nothing), or on the continuation page
when there is no empty row or it doesn't fit on one line. `_write_pdf`: when
a size is chosen for a box whose name is on a parent object (page 3
"Found guilty - Sentence received 1"), the parent gets the same size so
viewers don't draw it at auto size.

**Sentinel:** `/*FIX-F351-Q6Q7-ROWS*/{key:"convictionsAny"`

---

### FIX-F351-Q3-ROWS — paragraph 3 other children as rows (Nov 14 2026)

**Problem:** Form 35.1 paragraph 3 (other children you are or have acted as
a parent to) is a table on page 2; the app asked one free-text box and the
PDF left the table empty.

**Fix (bundle):** the `f351_other_children` screen's `otherChildren` text
box is replaced by `otherChildrenAny` (Yes/No) + `otherChildRows` (name,
birthdate as a date picker, relationship, lives with; up to 6), using the
`rows` type from FIX-F351-ROWS. Intro text updated (no more "write N/A").

**Filler side (FILLER_VERSION .52):** `_F351_TABLES` entry for paragraph 3
(page 2 relationship boxes are the ones named `) - child N`). Birthdate
printed dd/mm/yyyy, kept on one line. Name, birthdate and relationship
boxes made row-height in the working copy so the row lines up at the top.
"No" or an old "N/A" answer prints N/A.

**Sentinel:** `/*FIX-F351-Q3-ROWS*/{key:"otherChildrenAny"`

---

### FIX-F351-Q11-ROWS — paragraph 11 caregivers as rows (Nov 14 2026)

**Problem:** Form 35.1 paragraph 11 (who the child(ren) have lived with
since birth) is a 3-column table on page 4; the app asked one free-text box
and the PDF left the table empty.

**Fix (bundle):** the `f351_care_history` screen's `careHistory` text box
is replaced by `careRows` (child's name, caregiver(s), from date, to date;
up to 10), using the `rows` type from FIX-F351-ROWS. No Yes/No question
(every child has had a caregiver). The CAS questions are unchanged.

**Filler side (FILLER_VERSION .53):** `_F351_TABLES` entry for paragraph 11
with no Yes/No key. `_f351_q11_rows` joins From/To into one
"dd/mm/yyyy to dd/mm/yyyy" box; a blank To prints "present" (the screen
says to leave it blank if the child still lives there). A blank child name
is filled only when the case has exactly one child. Rows 6+ and too-long
cells go to the continuation page. An old free-text answer goes to the
continuation page with "See continuation page" in row 1. Child's name boxes
made row-height so rows line up.

**Sentinel:** `/*FIX-F351-Q11-ROWS*/{key:"careRows"`

---

### FIX-F351-Q12B-ROWS — paragraph 12(b) people living with you as rows (Nov 14 2026)

**Problem:** Form 35.1 paragraph 12(b) (people other than the children in
this case who will live with you) is a 5-column table on page 4; the app
asked one free-text box and the PDF printed nothing.

**Fix (bundle):** in the `f351_plan` screen, the `householdMembers` text
box is replaced by `householdAny` (Yes/No) + `householdRows` (full legal
name and other names, birthdate date picker, relationship, children's aid
Yes/No + details, criminal Yes/No + details; up to 8).

**FIX-F351-ROWS-SHOWIF (same commit):** the generic rows renderer now
honours `showIf` on a column, pointing to another column in the same row.
Used here so "Give details" shows only after Yes. Columns without
`showIf` are unchanged.

**Filler side (FILLER_VERSION .54):** `_F351_TABLES` entry for 12(b), 4
printed rows. `_f351_q12b_rows` prints the children's aid and criminal
boxes as "No", or "Yes. <details>"; details are printed only when the
answer is Yes. Birthdate dd/mm/yyyy on one line. Birthdate and
relationship boxes made row-height. "No" prints N/A. Rows 5+ and
too-long cells go to the continuation page. An old free-text answer goes to
the continuation page.

**Sentinel:** `/*FIX-F351-Q12B-ROWS*/{key:"householdAny"`

---

### FIX-F351-Q12C-WHO — paragraph 12(c) who makes decisions (Nov 14 2026)

**Problem:** Form 35.1 paragraph 12(c) has 3 tick boxes (jointly by me
and [names] / by me / by [names]) plus an additional-details box. The app
asked one free-text box; the filler ticked from `affidavit_by`, which no
screen saves, so nothing was ever ticked or printed.

**Fix (bundle):** in the `f351_plan` screen, `decisionWho` (choice: me
and someone else jointly / me / someone else) is added, with
`decisionJointWith` or `decisionOthers` (names) shown for the matching
choice. The existing `decisionMakingPlan` box stays, now optional and
labelled "Further details".

**Filler side (FILLER_VERSION .55):** one tick from `decisionWho`; the
names box only for its own choice; details in the additional-details box
(sized to fit, else continuation page). Nothing is ticked from the older
free text. The dead `affidavit_by` lines are removed.

**Sentinel:** `/*FIX-F351-Q12C-WHO*/{key:"decisionWho"`

---

### FIX-F351-Q12D-WORK — paragraph 12(d) work and school ticks (Nov 14 2026)

**Problem:** Form 35.1 paragraph 12(d) has tick boxes (stay-at-home / I
work full or part time / I attend school full or part time / my plans may
change) plus a changes box. The app asked one free-text box; the filler
ticked from `employment_status` / `work_schedule`, which no screen saves.

**Fix (bundle):** in the `f351_plan` screen, `workSituation` is replaced by
`workStatus` (choose all that apply: home / work / school), `workTime` and
`schoolTime` (full / part, shown for their choice), `plansChange` (Yes/No)
and `plansChangeDetails` (shown on Yes). `workplaceName` now shows only when
work or school is chosen.

**Filler side (FILLER_VERSION .56):** ticks from those answers; full/part
time only under its own choice; workplace printed when work or school is
chosen (or the question is unanswered); changes box only on Yes. The older
free-text answer goes to the continuation page until the new question is
answered; nothing is ticked from it. Dead tick lines removed.

**Sentinel:** `/*FIX-F351-Q12D-WORK*/{key:"workStatus"`

---

### FIX-F351-Q12H-ROWS — paragraph 12(h) special needs per child (Nov 14 2026)

**Problem:** Form 35.1 paragraph 12(h) has a 4-row table on page 5 (child's
name; medical / educational / mental health / developmental / other ticks;
description; support or services). The app asked one free-text box and the
table was left empty (only the top "does not / has" tick was set).

**Fix (bundle):** in the `f351_plan` screen, `specialNeedsDetails` is
replaced by `specialNeedsRows` (shown on Yes; up to 8): child's name, need
types (choose all that apply), description, support. Uses the `rows` type;
the need types use the existing `checkboxes` type inside a row.

**Filler side (FILLER_VERSION .57):** `_f351_fill_needs` fills names, the
five ticks per child, description and support (sized to fit). A blank name
is filled only when the case has exactly one child. Rows 5+ and too-long
text go to the continuation page. An old free-text answer goes to the
continuation page until rows are filled. Name boxes made row-height.

**Sentinel:** `/*FIX-F351-Q12H-ROWS*/{key:"specialNeedsRows"`

---

## FIX-F10-COURT — Form 10 asks for the court (Nov 15 2026)

**Problem:** Form 10 (Answer) had no court questions, so the courthouse,
court office address and court file number were blank on every page.
Also, the shared "Court information" screen saves `fileNumber`, which the
server turns into `file_number`, but the filler reads `court_file_number`,
so a typed file number never printed on any form.

**Client:** a "Court information" screen is now step 1 of 5 in the Form 10
questions (`const Ky`). It uses the shared `court` section and the same
keys (`courthouse`, `fileNumber`) as the Form 8 court screen, so the
answer is shared across the case's forms and never asked twice (the
package builder skips a second `court` screen by id). Both fields are
required; the respondent copies them from the Application they received.
The other Form 10 steps are renumbered 2–4 of 5.

**Filler side (FILLER_VERSION .59):** `_fe_flat` copies `file_number` into
`court_file_number` when that is empty (never overwrites).

**Sentinels:** `Form 10 — Step 1 of 5",intro:"Copy these from the top of the Application`
and `/*FIX-F10-COURT*/{id:"f10_respondent"`

---

## FIX-F10-TICKS — Form 10 page 2 tick boxes (Nov 15 2026)

**Problem:** the page 2 tick boxes (paragraphs 3, 4, 5) were never ticked.
Paragraphs 3 and 5 had no question in the app.

**Client:** two questions added to the Form 10 "What you agree and
disagree with" screen (`f10_dispute`):
- `askDismiss` (yes/no, required): paragraph 3, dismiss with costs.
- `familyHistory` (select, required): `correct` / `notCorrect`, paragraph 5.
- `familyHistoryDifferences` (textarea, shown only for `notCorrect`, not
  required so the progress count isn't blocked when hidden).
Paragraph 4 needs no question: it is ticked when "Any claims you are
making" has text.

**Filler side (FILLER_VERSION .60):** `fill_form10` ticks para 3 on yes,
para 4 when own claims has text (or legacy `making_own_claim`), para 5 plus
"is correct" / "is not correct". The differences go on the continuation
pages as paragraph 5 (before paragraph 6). No answer = no tick.

**Sentinels:** `/*FIX-F10-TICKS*/{key:"askDismiss",type:"yesno"` and
`{key:"familyHistory",type:"select",label:"Is the Family History in the Application correct?"`

---

## FIX-F10-CLAIM-PAGE — Form 10 page 4 claim boxes (Nov 15 2026)

**Problem:** page 4 (Claim by Respondent) paragraphs 7 and 8 were never
filled; the app had no questions for them.

**Client:** added to the Form 10 `f10_dispute` screen, right after "Any
claims you are making" (all optional, so the progress count isn't
blocked for people with no claim of their own):
- `ownClaimAgainst` (select): `applicant` / `addedParty`.
- `ownClaimAddedParty` (text, shown for `addedParty`).
- `ownClaimTypes` (checkboxes, 21 options matching the page 4 boxes,
  except the child-protection column and the two wrongful-removal boxes).
- `ownClaimOther` (text, shown when `other` is chosen).

**Filler side (FILLER_VERSION .61):** only when paragraph 4 is ticked.
Para 7: X in "the applicant" or "an added party" (+ name). With no answer
and no added party anywhere in the case, the applicant is the only other
party, so it is marked. Para 8: Divorce Act column only when the
respondent claims a divorce; otherwise Family Law Act / CLRA column.
Divorce and property claims at an Ontario Court of Justice are left
unticked and logged (the form's own column notes). Paragraph 4 is also
ticked when claim types are chosen. Boxes 06 and 50 get the same framed
look as the rest of page 4 (`_f10_match_odd_boxes`).

**Sentinels:** `/*FIX-F10-CLAIM-PAGE*/{key:"ownClaimAgainst",type:"select"`
and `{key:"ownClaimTypes",type:"checkboxes",label:"If you are making a claim of your own: what are you asking the court for?`

---

## FIX-F10-CLAIM-FACTS — Form 10 page 5 facts (Nov 15 2026)

**Problem:** page 5 (Important facts supporting my claim(s)) was never
filled; the app had no question for it.

**Client:** `ownClaimFacts` (textarea, optional) added to the Form 10
`f10_dispute` screen after the claim-type questions.

**Filler side (FILLER_VERSION .62):** fills 'Facts that form the legal
basis for your claim(s)' sized to fit; overflow goes to the continuation
pages ("Page 5. Important facts supporting my claim(s)") and the box says
"See attached continuation page, page 5." Blank answer = blank page 5
(paragraph 6's facts are not copied; they answer a different question).

**Sentinel:** `/*FIX-F10-CLAIM-FACTS*/{key:"ownClaimFacts",type:"textarea"`

---

## FIX-F351-PARTB — Form 35.1 Part B, pages 7–8 (Nov 15 2026)

**Problem:** Part B (for a non-parent asking for decision-making
responsibility) was never filled. The app asked Q16, Q18 and Q19 as single
free-text boxes (the form has tables), asked Q17 only as attached/requested
(no date, no police force, no offences since the check), and the filler had
no Part B code at all.

**Client (`f351_partb` screen):** after `isNonParent` —
`childCasesAny` (yes/no) + `childCaseRows` (rows: children, type, details,
max 5); `policeCheck` (kept) + `policeCheckDate` (date, attached),
`policeNewOffencesAny` (yes/no, attached) + `policeNewOffences` (textarea),
`policeRequestDate` (date, requested), `policeForce` (text, requested);
`addressRows` (rows: dates, place, max 10); `casSocietyRows` (rows: name,
max 6). None are required (hidden required fields block the progress
count). The old free-text keys are no longer asked.

**Filler side (FILLER_VERSION .63):** everything in Part B prints only when
"Part B applies to you" is Yes; otherwise pages 7–8 stay blank. Q16/Q18/Q19
use the `_F351_TABLES` machinery (Q16 "No" = N/A; rows past the printed rows
and too-long cells go on the continuation page; older free-text answers go
on the continuation page or print N/A). Q17: one tick; the report date
(attached) or request date + police force (requested) print only under their
option, dates dd/mm/yyyy. The offences line has no box on the form, so a
one-line box ('Q17 offences since police records check') is added to the
fill's working copy only when there is an answer (offences, or N/A for No).
Signatures, the commissioner block and the Q20 initials stay blank.

**Not changed:** the old in-app jsPDF Form 35.1 preview still reads the old
free-text keys (same as the earlier Form 35.1 row bricks).

**Sentinels:** `/*FIX-F351-PARTB*/{key:"childCasesAny",type:"yesno"` and
`{key:"addressRows",type:"rows",label:"Where you have lived since turning 18`

---

## FIX-EXPORT-LEGACY-PDF (Nov 16 2026)

**Problem.** Each form card on the Export page (`/case/:id/export`) had a second button that built a home-made copy of the form in the browser with jsPDF (the old in-app generators: `ZI`/`XI` for Form 35.1, `tO`, `nO`, `aO`, `sO`, `cO`, `dO`, `hO`, `mO`, `gO`, `bO`, `wO`, and `QI` as the default). Paid plans saw it as "Preview PDF" next to "Official Court PDF"; free plans saw it as "Download PDF". These old generators read retired answer keys (for Form 35.1, 14 keys no longer asked), so new answers showed as blank or "(not provided)". The copies were not the official court forms and had no "not for filing" mark. Free users could also download them, even though the app says a Standard plan is needed to download PDFs.

**Fix.** In the card button array, the old button is now behind a check:
- `r?.plan === "free"` shows a link to `/subscription` with the button "Upgrade to download" (testid `button-upgrade-${key}`). This is the same pattern the Review page already uses (`button-upgrade-to-download`).
- Paid plan and the form has an official PDF (`xt[key]`): no second button, only "Official Court PDF".
- Paid plan and no official PDF (currently only `form13_1`): the old "Download PDF" button stays.

**Sentinel.** `/*FIX-EXPORT-LEGACY-PDF*/r?.plan==="free"?s.jsx(Zt,{href:"/subscription"`

The old generator functions are still in the bundle (Form 13.1 uses one) but nothing else calls them.

## FIX-F131-B1 (Nov 16 2026)

**Problem.** Item 5 of Forms 13 and 13.1 is a sworn statement. The person either attaches their tax returns and notices of assessment for the past three years, or says they are an Indian under the Indian Act who chose not to file and lists other proof. The app never asked about it, so both boxes always stayed blank.

**Fix.** Two new questions on Form 13's employment screen (`f13_employment`), which Form 13.1 will share (Form 13.1 plan, brick 1):
- `taxDocs` (select): `attaching` or `indian_act`. Optional.
- `indianActDocs` (textarea), shown only when `taxDocs` is `indian_act`.

The filler (`fill_form13`, `fill_form13_1`) ticks the matching item 5 box. For `indian_act` it also prints the document list. No answer leaves both boxes blank.

**Sentinel.** `/*FIX-F131-B1*/{key:"taxDocs",type:"select"`

## FIX-F131-B2 (Nov 16 2026)

**Problem.** The Form 13.1 income table (lines 1–14) was filled by old code that read the unused `f13_1_*` screens and put some answers in the wrong boxes. Line 3's "monthly amount before expenses" bracket was never asked. Line 14 (non-cash benefits) is a 4-row table of Item / Details / Yearly Market Value, but the app only had one free-text box.

**Fix.** Two changes to Form 13's income screen (`f13_income`), which Form 13.1 will share (Form 13.1 plan, brick 2):
- New `inc_selfemployment_gross` (text): self-employment monthly amount before expenses. Prints in the line 3 bracket on Form 13.1.
- `inc_other_benefits` (textarea) replaced by `otherBenefitRows` (rows, max 4; columns item, details, value).

The filler (`fill_form13_1`) now reads `f13_income_*` (falling back to `f13_1_income_*`) for lines 1–11, works out line 12 (sum of printed lines) and line 13 (×12) itself, and leaves both blank when there are no amounts. `fill_form13` and `fill_form13_1` print benefit rows into the line 14 table. Old saved free text still prints in Details row 1, with no invented Item.

**Sentinels.** `/*FIX-F131-B2*/{key:"inc_selfemployment_gross"` and `{key:"otherBenefitRows",type:"rows"`

## FIX-F13-NO-CLIENT-PATCH (Nov 17 2026)

**Problem.** After the server returned a filled Form 13, an old browser patcher in `hp-patches.js` (`__patchForm13PDF_real`) ran on every download and email from the checkbox review dialog. It rewrote Part 2 with the raw wizard answers: the one automatic-deductions total on the CPP line, the combined utilities total on "Water", transportation on "Gas and oil", health on "Health insurance premiums", personal on "Entertainment/recreation", and the saved wizard total over the filler's total. That undid FIX-F13-AUTO-DEDUCTIONS, FIX-F13-COMBINED and FIX-F13-TOTALS, and it would also overwrite the per-line answers planned next.

**Fix.** The patcher returns `null` ("no change") right away, the same way FIX-F351-NO-CLIENT-PATCH turned off the Form 35.1 patcher. Callers already keep the server PDF when they get `null`. Cache token `hp-patches.js?v=20261117f13np`.

**Sentinel.** `// FIX-F13-NO-CLIENT-PATCH (Nov 17 2026)`

## FIX-F13-EXP-LINES (Nov 17 2026)

**Problem.** Forms 13 and 13.1 have one box per expense line, but the Form 13 expense screen asked some groups as one combined number (automatic deductions, utilities, transportation, health, personal). That number could only go in the group subtotal, so lines like Water, Heat, CPP and Gas stayed blank, even though the screen tells users the court expects every line filled. Some lines (household supplies, pet care, laundry, babysitting, transport repairs, school fees, children's clothing, summer camp and more) were never asked at all.

**Fix.**
- `f13_expenses` now asks one question per PDF line, in the form's order, each label starting with its group ("Utilities: Water $/month"). New keys include `exp_auto_cpp`, `exp_water`, `exp_public_transit`, `exp_entertainment`, `exp_education_desc` and others the filler already read. `exp_groceries`, `exp_childcare`, `exp_clothing` and `exp_children_activities` keep their keys with narrower labels.
- The earlier combined questions (`exp_auto_deductions`, `exp_utilities`, `exp_transit`, `exp_health`, `exp_personal`) stay on the screen only while they hold an answer, relabelled "(earlier answer)", so older cases can still see and clear them. This uses a new `showIf:{key,set:1}` form in `__hpShowOk`.
- Group rule, the same in the filler (`_fe_part2_expenses`) and in the in-app total (`__hpF13ExpTotal`): an earlier combined total counts only while none of the lines it covered has an answer. Personal's earlier total never covered clothing or education.

**Sentinels.** `/*FIX-F13-EXP-LINES*/{key:"exp_auto_cpp"`, `Re=__hpF13ExpTotal(u.f13_expenses||{})`, `/*FIX-F13-EXP-LINES*/if(f.showIf.set)`

## FIX-F13-NUM-ONLY (Nov 17 2026)

**Problem.** Every Part 2 expense box on Forms 13 and 13.1 is a dollar amount that feeds the subtotals. "Other expenses" was a free-text box ("e.g. Pet care $80/month") and its helper told users to type "360 Child Care". The app total counted the 360, but the PDF printed "360 Child Care" in the $ box and didn't add it, so the form's totals disagreed with the app.

**Fix (bundle, index-CNjoTsGP.js).**
- `exp_other` is now a one-line amount question ("Other: Other expenses not shown above $/month"). A new `exp_other_desc` question ("what the other expenses are (specify)") appears once an amount is entered, with a box-fit check for the 135pt specify box. `exp_education_desc` got a fit check for its 87pt box.
- All Form 13 expense and income money questions carry `num:1`. `__hpNumMsg`/`__hpNumNote` show an amber "Numbers only…" note (testid `num-warn-<key>`) under the input when the answer isn't a plain number. Those inputs also open the decimal keypad on phones (`inputMode`).
- `__hpExpNum(v,k)` counts only plain numbers. An old multi-line `exp_other` answer counts only when every line starts with an amount.
- The total's helper text now reads "Worked out from the amounts above."

**Fix (filler, dist/fill_pdf.py `_fe_part2_expenses`, FILLER_VERSION .70).** A money box that isn't a number is left blank and logged, and isn't counted. It still counts as "answered" for the group rule, the same as the app. For an old `exp_other` answer where every line starts with an amount, the amounts are added up and the remaining words become the specify text, unless `exp_other_desc` is filled in.

**Check.** Case 39 ("360 Child Care"): Form 13 and 13.1 now print Other 360.00, specify "Child Care", Other subtotal 360.00, monthly total 4117.63, which matches the app's saved total.

## FIX-F131-B4 (Nov 17 2026)

**Problem.** Form 13 Schedule B and Form 13.1 Part 3 ("Other income earners in the home") ask the same 7 lines of checkboxes and boxes. The wizard only had one free-text "Schedule B" box. The filler read structured `f13_scheduleB_*` answers that nothing ever asked for, so the checkboxes never filled. Form 13.1 Part 3 had no mapping at all.

**Fix (bundle, index-CNjoTsGP.js, Form 13 "Schedules & Summary" screen).** The old textarea is replaced with these questions:
- `sb_needed`: is this a spousal support or undue hardship claim? This is the form's own "complete only if" rule.
- `sb_live_alone`
- `sb_partner_any` and `sb_partner_name`
- `sb_adults_any` and `sb_adults_names`
- `sb_children_count`
- `sb_partner_works` (works / no_work) and `sb_partner_workplace`
- `sb_partner_earns` (earns / none), `sb_partner_earnings` and `sb_partner_earn_period`
- `sb_contrib_any`, `sb_contribution` and `sb_contribution_period`

Each follow-up shows only after the answer that leads to it. Name and workplace questions have box-fit checks (Form 13.1 box widths), and the money and number questions use the FIX-F13-NUM-ONLY warning. `numMsg` lets a field set its own warning text. The old `schedule_b` textarea is shown only if it already has an answer, labelled "(earlier answer)".

**Fix (filler, `_fe_sched_b(d)`, FILLER_VERSION .72).** Both `fill_form13` (Schedule B, page 7) and `fill_form13_1` (Part 3, page 4) read the same answers:
- Nothing prints unless `sb_needed` is Yes.
- "Lives alone" ticks line 1 only. Leftover answers to hidden questions never print.
- The "per" period is never defaulted. The old default was "month".
- The children count is asked directly. The old count was worked out from "lives with" answers and missed children from other relationships.
- Form 13.1 line 7 has no checkbox, only the amount and "per" boxes.

**Check.** Full, lives-alone, gate-No, does-not-work and bad-number scenarios were checked on both forms. Page renders were checked visually. No changes to existing output across 25 templates x 2 cases (neither case printed anything in Schedule B before).

## FIX-F131-B5 (Nov 17 2026)

**Problem.** Form 13.1 Part 4 starts with three dates (marriage, valuation, start of cohabitation if different), then 4(a) Land: ownership and %, address, the value of your interest on three dates, and total 15. None of it was filled. The app had no valuation-date or land questions for Form 13.1, only the old free-text property screens.

**Fix (bundle).** A new Form 13.1 screen, `f131_land` ("Property: key dates and land", in the Form 13.1 step list before the old property screens), asks:
- `valSameAsSep` (yes/no) and, only if No, `valuationDate`
- `livedTogetherBefore` (yes/no) and `cohabitationDate`
- `landAny` (yes/no) and `landRows` (rows, max 6): ownership, address, valueMarriage, valueValuation, valueToday (numbers only), and matrimonialHome (yes/no, used by Part 6 in brick 10)

The marriage date isn't asked again. It comes from "Your situation".

**Fix (filler, fill_form13_1, FILLER_VERSION .73).**
- Marriage and separation dates come from `situation_*`. Form 13B, 8A or 36 answers only fill a gap, and answers that disagree leave the box blank (logged).
- The valuation date is the separation date only when the user confirmed it. Otherwise it's their own answer.
- The cohabitation date prints only when it differs from the marriage date. Dates use dd/mm/yyyy.
- Land: the form has one row of value boxes, so property 1 prints there and the rest are logged for the continuation page (brick 12). Total 15 adds every property's valuation-date value, and stays blank if none was entered.
- "NONE" prints only when the user answered No to land.
- Rows are read up to `landRows_count`, so a removed row's leftover answers never print.

**Check.** Full, no-land, conflicting-dates and skipped scenarios, a page render, a browser run of the screen (show/hide, rows, number warning, saved keys), and the row-count case. Regression: no changes across 25 templates x 2 cases.

## FIX-F131-B6 (Nov 17 2026)

**Problem.** Form 13.1 Part 4(b) has four fixed lines (household goods and furniture; cars, boats, vehicles; jewellery, art, electronics, tools, sports and hobby equipment; other special items). Each has a description, an "Indicate if NOT in your possession" box and the value of your interest on three dates, then total 16. None of it was filled, and the app had no structured questions for it.

**Fix (bundle).** A new Form 13.1 screen, `f131_household` ("Property: household items and vehicles"), right after `f131_land`. For each line (`goods`, `vehicles`, `valuables`, `other`):
- `<line>Any` (yes/no). The rest shows only if Yes.
- `<line>Desc` (textarea, fit note), `<line>ValueMarriage`, `<line>ValueValuation`, `<line>ValueToday` (numbers only)
- `<line>NotHeld` (yes/no) and, only if Yes, `<line>NotHeldDetail` (which items, who has them)

**Fix (filler, fill_form13_1, FILLER_VERSION .74).**
- An explicit No prints "NONE" in that line's description. A skipped line stays blank, and leftover answers behind a No never print.
- "Indicate if NOT in your possession" prints the user's note, or "Not in my possession" if they answered Yes without details. Blank means in their possession.
- Values print as 0.00. A non-number is left blank and logged.
- Total 16 adds the valuation-date values of the Yes lines, and stays blank if none was entered.

**Check.** Full, all-No, skipped, bad-number and leftover-answer scenarios, a page render (including a long description), and a browser run of the screen. Regression: no changes across 25 templates x 2 cases.

## FIX-F10-APP-LAWYER (Nov 19 2026)

**Problem.** On the respondent path (Form 10), the app never asked for the applicant's lawyer. Forms 10 and 6B both have a lawyer box for the applicant, and a respondent usually serves their papers on that lawyer. The box always printed empty.

**Fix (bundle).** The Form 10 "Applicant's information" screen (`f10_applicant`) now asks `hasLawyer` (yes/no) and, only if Yes, `lawyerName`, `lawyerFirm`, `lawyerAddress`, `lawyerPhone`, `lawyerEmail`. It is asked once and shared by both forms.

**Fix (filler, `_fe_flat`, FILLER_VERSION .78).** When `f10_<side>_has_lawyer` is yes, `f10_<side>_lawyer_<name|firm|address|phone|email>` fills `<side>_lawyer_*` only when that main key is empty. A leftover answer behind a No never prints. Form 10's lawyer phone is now formatted like the other phone numbers.

## FIX-F6B-SCREEN (Nov 19 2026)

**Problem.** Form 6B has boxes the 6B screen never asked about: "lawyer of record" for special service, the adult's name for service at a residence, whose address was used for mail or courier (paragraphs 4 and 5), and the courier pickup time, a.m./p.m., date and company.

**Fix (bundle).** On `f6b_service`:
- `specialServiceHow` gets a new option `lawyer_of_record` ("Left with their lawyer of record").
- `residenceAdultName` (shows only for `residence_adult`).
- `addressIs` (shows for mail and both courier options): business, lawyer_accepted, lawyer_of_record, home, last_filed, other, plus `addressIsOther` (only for other).
- `courierPickupTime`, `courierPickupAmPm` (a.m./p.m.), `courierPickupDate`, `courierName` (show only for courier).

**Fix (filler, fill_form6b, FILLER_VERSION .78).**
- `lawyer_of_record` ticks "leaving a copy with (name)" and "who is the person's lawyer of record", with the other side's lawyer name if saved.
- `residence_adult` prints the adult's name.
- `addressIs` ticks the one matching box in paragraph 4 (mail) or 5 (courier); "other" prints the note.
- The courier pickup time, a.m./p.m., date (dd/mm/yyyy) and company go in paragraph 5.
- A dropdown's selected-item index (`/I`) is updated to the chosen option, so viewers show "a.m." rather than the "a.m./p.m." placeholder.

## FIX-F13A (Nov 19 2026)

**Problem.** Anyone who files a financial statement (Form 13 or 13.1) must also serve and file Form 13A, the Certificate of Financial Disclosure. The app had the blank template (`dist/public/pdfs/form13a.pdf`) but no screen, no filler and no download button.

**Fix (bundle).**
- New step object `__hpF13A` (id `f13a_disclosure`, "Financial disclosure (Form 13A)"), defined just before `const kh=[` and added as the last Form 13 step (`kh`) and before `f13_1_review` in the Form 13.1 steps. The combined path de-duplicates by id, so it shows once.
- Questions: `docs` (rows, max 60) with columns `category` (29 options, one per table on the form, in form order), `description`, `docDate`, `providedDate`; plus optional `certifyDate`.
- FIX-F13A-EXPORT: the export page shows a "Form 13A" card when the case has Form 13 or 13.1 (`H||q`), and `xt` maps `form13a` to `form13a`, so only the Official Court PDF button shows.

**Fix (filler, fill_form13a, FILLER_VERSION .79).**
- Header, both parties, both lawyers (from the main keys, incl. the Form 10 gap-fill), "filed by" (`_fe_filer_side`), court file number on pages 2-7.
- Each document goes in its category's table; numbered 1, 2, 3... in print order; dates printed yyyy/mm/dd as the form asks. More than 5 in one category go on a continuation page. A row with no category is not printed and is logged.
- "Certified at" = the filer's city; date only if `certifyDate` is answered. Signature always blank. Text is 9pt, smaller only when too wide.

## FIX-F351A (Nov 19 2026)

**Problem.** Family Law Rules r. 35.1(1)(a) require Form 35.1A (Affidavit, child protection information) with Form 35.1 whenever the child or any party has been involved in a child protection case or received services from a children's aid society. Under r. 35.1(6) the clerk must refuse the filing without it. The app asked the CAS question (Form 35.1 Q14) but had no 35.1A screen, template, filler or download. The `casNote` tip also said 35.1A was needed only for a court case, which was wrong.

**Fix (bundle).**
- Step `f351_care_history`: after `casNote`, four yes/no questions, each with a rows table (max 10), all shown only when `casInvolved` = yes (nested showIf):
  - `casCourtMineAny` / `casCourtMine` (para 1): columns people, cas, location, orders, when
  - `casServicesMineAny` / `casServicesMine` (para 2): people, cas, location, services, when
  - `casCourtOtherAny` / `casCourtOther` (para 3), `casServicesOtherAny` / `casServicesOther` (para 4)
  - "when" is free text so approximate dates ("approx. spring 2024", "unknown") are allowed.
- The `casNote` tooltip now says 35.1A is needed for any CAS involvement.
- FIX-F351A-EXPORT: a "Form 35.1A" card shows when the case has Form 35.1 (`Z`) and the saved `casInvolved` is "yes"; `xt` maps `form35_1a` to `form35_1a`.

**Fix (template + filler, fill_form35_1a, FILLER_VERSION .80).**
- New template `dist/public/pdfs/form35_1a.pdf`: the official FLR 35.1A (Dec 1, 2020) from ontariocourtforms.on.ca, unchanged.
- Header from `_header` (court address, file number pages 1-2, both parties). Lawyer boxes are built from the separate lawyer answers (name, firm, address, phone, email), with the one-line answer as the fallback. The court name is a dropdown on this template; it is set to the matching choice (OCJ / SCJ / SCJ Family Branch), or left blank and logged if no choice matches.
- Name and "I live in" use the same rule as Form 35.1 (main-case answer first, Form 35.1 identity answer as the fallback; a difference is logged).
- Each part: "No" prints "None." in the first cell; unanswered stays blank; "Yes" prints the rows. The last column is "what (when)". Filled table cells are set to wrap, and the size is 9pt, smaller (not below 5pt) to fit. Rows beyond the form's rows (4, 4, 3, 3), or too long to fit, go on a continuation page. A row too long to fit says "See continuation page, item N"; when there are more rows than the form has, the last row says "See continuation page, items N-M".
- The sworn block, signature and commissioner always stay blank.

## FIX-PHONE-NOT-MONEY (Nov 20 2026)

**Problem.** The site-wide phone formatter in `hp-patches.js` (`scanPhoneInputs`) attaches to every input whose id, name or test id contains "phone", "mobile" or "tel". The Form 13 / 13.1 expense boxes `exp_telephone` ("Utilities: Telephone (landline) $/month") and `exp_cell_phone` matched, so typing 45.50 became "(455) 0" and that was saved.

**Fix (hp-patches.js).** `scanPhoneInputs` skips inputs with `inputmode="decimal"` (all money boxes use it) and any input whose id starts with `field-exp_`. Real phone boxes are unchanged. Cache token `hp-patches.js?v=20261120ph1`.

**Tested.** Browser: both expense boxes keep "45.50" after leaving the box; the Form 10 phone box still formats 2262203289 as (226) 220-3289.

## How to add a new bundle patch

1. Make the string-replace edit in `dist/public/assets/index-CNjoTsGP.js`
   (or `dist/public/assets/hp-patches.js`).
2. Choose a distinctive substring from your change as the sentinel. It
   should be:
   - Present exactly once (or at least always present, even if it appears
     more than once).
   - Long enough to be unique (usually 15+ characters).
   - Short enough to survive minor minifier changes.
   - Not something that would coincidentally appear in a stock rebuild.
3. Add an entry to the `PATCHES` array in
   `scripts/check-bundle-patches.mjs` with `commit`, `name`, `file`, and
   `sentinel`.
4. Add a matching numbered section to this file.
5. Run `npm run check-bundle` locally to confirm the guard passes.
6. Commit both the bundle edit AND the guard update in the same commit.

## How to retire a bundle patch (port to source)

1. Identify the `.tsx` source file that should contain the fix.
2. Apply the fix there.
3. Run `npm run build` (once a build pipeline exists) and verify the
   compiled bundle still contains the sentinel (it should — the fix is now
   in source too).
4. Once you've verified the fix behaves identically end-to-end on a
   locally-built bundle, remove the entry from both:
   - The `PATCHES` array in `scripts/check-bundle-patches.mjs`
   - This file
5. Commit.
