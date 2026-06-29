# Hearth & Page — Ontario Family Law Intake

> A calm, guided tool for self-represented people navigating Ontario family court.

Hearth & Page walks users through Ontario's Family Law Rules forms in plain language — one step at a time, saved privately, exportable as a court-ready PDF.

---

## Live App

| Environment | URL |
|---|---|
| Production (Railway) | https://api-production-2334.up.railway.app |
| GitHub Pages (prototype) | https://[your-username].github.io/hearth-and-page |

---

## What It Does

- **Guided onboarding** — 3-question intake quiz routes users to the right forms for their situation
- **19 Ontario forms** — Form 4 through Form 36, fully guided with plain-language questions
- **Auto-fill** — answers carry forward across all forms in a case
- **Subscription gating** — free plan allows Form 8; PDF export requires Standard or Plus
- **Private & encrypted** — all data stored in Supabase, tied to the user's account

---

## Tech Stack

| Layer | Service |
|---|---|
| Frontend | HTML + Vanilla JS (FormEngine + hp-patches) |
| Backend | Node.js / Express on Railway |
| Database | Supabase (PostgreSQL + Auth) |
| Payments | Stripe (Standard $9.99/mo CAD, Plus $19.99/mo CAD) |
| Email | Resend (`support@hearthandpage.ca`) |
| Domain | Namecheap — `hearthandpage.ca` |

---

## Project Structure

```
hearth-and-page/
├── src/                        # Frontend prototype (deployed to GitHub Pages)
│   ├── index.html              # Main app shell
│   ├── hp-patches.js           # All form defs, onboarding, UI patches
│   ├── FormEngine.js           # Form rendering engine
│   └── favicon.png
│
├── docs/
│   ├── forms/                  # One markdown file per Ontario form
│   │   ├── form8.md
│   │   ├── form13.md
│   │   └── ...
│   ├── architecture/
│   │   ├── overview.md         # System architecture
│   │   ├── autofill.md         # Auto-fill key system
│   │   └── subscription.md     # Freemium & billing logic
│   └── roadmap.md              # Build roadmap and weekly progress
│
├── .github/
│   └── workflows/
│       └── deploy-pages.yml    # Auto-deploy src/ to GitHub Pages on push to main
│
└── README.md
```

---

## Ontario Forms Registry

| Form | Title | Status | Revised |
|---|---|---|---|
| Form 4 | Notice of Change in Representation | ✅ Live | June 2025 |
| Form 6B | Affidavit of Service | ✅ Live | April 2016 |
| Form 8 | Application (General) | ✅ Live | June 2025 |
| Form 10 | Answer | ✅ Live | June 2025 |
| Form 13 | Financial Statement (Support Claims) | ✅ Live | May 2021 |
| Form 13.1 | Financial Statement (Property & Support) | ✅ Live | May 2021 |
| Form 13B | Net Family Property Statement | ✅ Live | May 2009 |
| Form 14 | Notice of Motion | ✅ Live | March 2018 |
| Form 14A | Affidavit (General) | ✅ Live | Sept 2005 |
| Form 14B | Motion Form | ✅ Live | Sept 2021 |
| Form 15 | Motion to Change | ✅ Live | Sept 2021 |
| Form 15A | Change Information Form | ✅ Live | (retired 2020) |
| Form 15C | Consent Motion to Change | ✅ Live | Dec 2020 |
| Form 17 | Conference Notice | ✅ Live | Nov 2018 |
| Form 17E | Trial Management Conference Brief | ✅ Live | Sept 2023 |
| Form 23C | Affidavit for Uncontested Trial | ✅ Live | Dec 2020 |
| Form 25 | Order (General) | ✅ Live | Dec 2020 |
| Form 25A | Divorce Order | ✅ Live | Sept 2005 |
| Form 35.1 | Affidavit (Decision-making, Parenting, Contact) | ✅ Live | Sept 2021 |
| Form 36 | Affidavit for Divorce | ✅ Live | April 2024 |

---

## Weekly Build Log

| Week | Forms Added | Status |
|---|---|---|
| Weeks 1–6 | Forms 8, 13, 13.1, 14, 14A, 6B, 10, 23, 36, 25A | Complete |
| Week 7 | Form 15 (Motion to Change) + Form 15A | Complete |
| Week 8 | Form 17 (Conference Notice) + Form 17E | Complete |
| Week 9 | Form 35.1 (Affidavit Custody/Access) + Form 14B | Complete |
| Week 10 | Form 13B (Net Family Property) + Form 23C | Complete |
| Week 11 | Form 25 (Order General) + Form 4 | Complete |
| Task A | Form accuracy audit — corrected Form 23→15C, Form 26B→23C | Complete |
| Task B | Guided onboarding flow (3-step intake quiz) | Complete |
| Task C | GitHub repo + Pages deploy | ← Current |

---

## Getting Started (Local Dev)

```bash
# No build step required — pure HTML/JS
# Just open src/index.html in a browser, or serve it locally:
npx serve src/
```

The app connects to the live Railway backend — no local server needed for frontend testing.

---

## Deployment

**Frontend (GitHub Pages):** Automatically deployed on every push to `main` via GitHub Actions.

**Backend (Railway):** Deploy manually from the family-law-app workspace:
```bash
RAILWAY_TOKEN=<token> railway up --service <service-id> --detach
```

---

## Legal Notice

Hearth & Page is not a law firm and does not provide legal advice. All forms are based on the Ontario Family Law Rules. Users are responsible for verifying their completed forms before filing with the court.

*© Hearth & Page — hearthandpage.ca*
