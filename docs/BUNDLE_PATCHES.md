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
