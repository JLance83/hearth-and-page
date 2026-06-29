# Hearth & Page — Project Roadmap

## Vision

A national self-help legal intake platform — starting with Ontario family court, expanding province by province across Canada, then US state by state, then international markets.

---

## Phase 1 — Ontario MVP (Current)

**Goal:** All common Ontario Family Law Rules forms, fully guided, with PDF export.

### Completed
- [x] Core form engine (FormEngine.js + hp-patches.js)
- [x] Supabase auth (sign up, login, email verification)
- [x] Stripe subscription (Standard $9.99/mo, Plus $19.99/mo CAD)
- [x] Freemium gate (Form 8 free, PDF export locked to paid)
- [x] Auto-fill system across all forms
- [x] 19 Ontario forms live (Form 4 through Form 36)
- [x] 16 onboarding pathways
- [x] Guided 3-step intake quiz
- [x] Form accuracy audit (all forms verified against official Ontario registry)
- [x] "Hearth & Page" fine print on all exported PDFs
- [x] GitHub repo + GitHub Pages deploy

### In Progress / Upcoming
- [ ] Remaining Ontario forms (target: 25+ total)
- [ ] PDF export — verify Hearth & Page watermark on all form types
- [ ] Manual pilot test — full end-to-end on iPhone and MacBook
- [ ] User feedback form (in-app)
- [ ] Form 15A retirement — confirm replacement path for users
- [ ] Mobile responsive polish

---

## Phase 2 — Ontario Launch

- [ ] Custom domain on GitHub Pages (`app.hearthandpage.ca`)
- [ ] Production-grade Railway deploy (auto-deploy via CI)
- [ ] Beta user program (invite 10–20 self-represented Ontarians)
- [ ] Legal disclaimer review
- [ ] Privacy policy + terms of service
- [ ] Accessibility audit (WCAG 2.1 AA)

---

## Phase 3 — Canada Expansion

- [ ] British Columbia family law forms
- [ ] Alberta family law forms
- [ ] Quebec (bijural — civil law system, separate track)
- [ ] Prairie provinces
- [ ] Atlantic provinces
- [ ] Multi-province account (one login, province selector)

---

## Phase 4 — US Expansion

- [ ] State-by-state analysis — start with highest self-rep rates (California, Texas, Florida, New York)
- [ ] US entity formation
- [ ] USD billing track

---

## Phase 5 — International

- [ ] Australia (family law forms — federal jurisdiction)
- [ ] UK (England & Wales)
- [ ] EU assessment

---

## Revenue Model

| Plan | Price | Features |
|---|---|---|
| Free | $0 | Form 8 guided fill, account required, no PDF export |
| Standard | $9.99/mo CAD | All forms, PDF export, 1 active case |
| Plus | $19.99/mo CAD | All forms, PDF export, unlimited cases, priority support |

Recurring monthly billing until cancelled. No "plan expired" for active subscribers — only failed payments trigger grace period.
