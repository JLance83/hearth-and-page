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
