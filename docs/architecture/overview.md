# System Architecture — Hearth & Page

## Overview

Hearth & Page is a two-tier web application:

```
Browser (HTML/JS)
      ↕
Railway Backend (Node.js/Express)
      ↕
Supabase (PostgreSQL + Auth)
```

---

## Frontend

**Technology:** Pure HTML + Vanilla JavaScript  
**Entry point:** `src/index.html`  
**Key files:**
- `FormEngine.js` — renders form steps, handles validation, manages step navigation
- `hp-patches.js` — contains all form definitions, onboarding logic, UI patches, and subscription enforcement

The frontend is **stateless** — all data is fetched from the Railway backend on load. No localStorage is used for sensitive data.

### Form Definition Structure

Each form is registered as a `window.__hp_formDefs['ON-FXX']` object:

```js
window.__hp_formDefs['ON-F8'] = {
  formCode: "form8-general",
  formNumber: "Form 8",
  title: "Application (General)",
  jurisdiction: "Ontario",
  steps: [
    {
      step: 1,
      title: "Court Information",
      fields: [
        {
          id: "courthouse",
          label: "Which courthouse will you be filing at?",
          type: "select",
          autoFill: "courthouse",
          required: true
        }
      ]
    }
  ]
};
```

---

## Backend

**Technology:** Node.js / Express  
**Hosting:** Railway  
**URL:** `https://api-production-2334.up.railway.app`

### Key Endpoints

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/auth/register` | Create account |
| POST | `/api/auth/login` | Login, returns session token |
| GET | `/api/cases` | List user's cases |
| POST | `/api/cases` | Create new case |
| GET | `/api/cases/:id/answers` | Fetch saved answers for a case |
| POST | `/api/cases/:id/answers` | Save answers |
| POST | `/api/stripe/checkout` | Create Stripe checkout session |
| POST | `/api/stripe/webhook` | Handle Stripe billing events |
| POST | `/api/__admin/ensure-testuser` | Dev: reset test account |

---

## Database (Supabase)

**Project:** Hearth-and-Page  
**Region:** Canada (Toronto)

### Key Tables

| Table | Purpose |
|---|---|
| `users` | Account info, plan, subscriptionStatus |
| `cases` | One per matter (title, caseType, userId) |
| `answers` | Key-value store of form answers per case |
| `sessions` | Auth session tokens |

---

## Auto-fill System

Fields with an `autoFill` key share their value across all forms in the same case.

**Standard auto-fill keys:**

| Key | Populated from |
|---|---|
| `courthouse` | Form 8, Step 1 |
| `court_file_number` | Form 8, Step 1 |
| `applicant_full_name` | Form 8, Step 2 |
| `respondent_full_name` | Form 8, Step 3 |
| `marriage_date` | Form 8, Step 6 |
| `separation_date` | Form 8, Step 6 |
| `user_address` | Form 8, Step 2 |
| `user_phone` | Form 8, Step 2 |
| `user_email` | Form 8, Step 2 |

When a user fills out Form 8 first, all subsequent forms in the case pre-populate these fields automatically.

---

## Subscription Enforcement

```
User logs in
  → plan: 'free'   → Form 8 accessible, all others locked, PDF export locked
  → plan: 'standard' or 'plus' → All forms accessible, PDF export unlocked
```

Failed payments trigger a grace period. Active subscribers are never blocked mid-subscription.
