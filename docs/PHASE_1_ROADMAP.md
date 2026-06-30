# Hearth & Page — Phase 1 Nationwide Roadmap

**Status:** Draft  
**Owner:** @sole-dev  
**Last updated:** 2026-06-30  
**Scope:** Path from Ontario-only prototype → first multi-jurisdictional release (Ontario + one additional province)  
**Out of scope for Phase 1:** US, EU, AU expansion (see §5)

---

## Phase 1 definition

Phase 1 ends when Hearth & Page is **operating in Ontario as a paid product** and **launched in one additional Canadian province** on the same codebase, same pricing engine, and same rule-monitor pipeline — with no province-specific forks.

Phase 1 does **not** require nationwide coverage. The point of Phase 1 is to prove the system is *replicable*, not to be everywhere.

---

## 1. Ontario exit criteria

Ontario is the reference implementation. We do not begin province #2 work until **all** of the following are true. These are gates, not targets.

### 1.1 Product gates
- [ ] All 26 Ontario court forms render and export correctly (all fill functions tested end-to-end).
- [ ] End-to-end intake → form-fill → PDF export tested on the three live pricing tiers (Free, Standard, Plus).
- [ ] Stripe checkout live, refunds tested, tax handling correct for Ontario (HST 13%).
- [ ] Resend transactional email working for receipts, password reset, and document delivery.
- [ ] Form output reviewed by at least one Ontario family lawyer or licensed paralegal for accuracy.

### 1.2 Compliance gates
- [ ] App contains visible, non-dismissible "not legal advice" disclosure on every intake screen.
- [ ] Privacy policy and terms reviewed against PIPEDA + Ontario equivalents.
- [ ] Data residency confirmed (Supabase region, Railway region) and documented.
- [ ] No language anywhere in the product that could be read as legal advice or as offering legal services within the meaning of the *Law Society Act* (Ontario).

### 1.3 Commercial gates
- [ ] ≥ 25 paying users across any tier, OR ≥ $500 CAD MRR — whichever comes first.
- [ ] 30-day refund rate below 15%.
- [ ] At least 5 written user-feedback responses collected via post-purchase email.
- [ ] No P0 bugs open for ≥ 14 consecutive days.

### 1.4 Operational gates
- [ ] Weekly Ontario Family Law Rule Monitor has caught and surfaced ≥ 1 real rule change with a documented response.
- [ ] Backup and restore tested on Supabase production.
- [ ] Deploy rollback procedure documented (Netlify + Railway).

**Exit decision:** When all of the above are green, file a "Ready for Province #2" issue and proceed to §2.

---

## 2. Province #2 selection criteria

Two candidates pre-selected: **British Columbia** and **Alberta**. Both have well-documented public court forms, large self-represented-litigant populations, and English-only family-law procedures. Pick one — not both.

### 2.1 Scoring framework

Score each province 1–5 on each dimension. Highest total wins. Decision recorded in `decisions/province-2.md` before any code work begins.

| Dimension | BC notes | Alberta notes |
|---|---|---|
| **Form overlap with Ontario** | Moderate overlap on financial/support concepts | Fewer total forms, simpler structure |
| **Market size (SRL population)** | Larger metro (Vancouver) + island/remote population | Calgary + Edmonton; high English-speaking SRL share |
| **Form availability & licensing** | BC forms via Queen's Printer — check redistribution terms | Alberta forms on albertacourts.ca — check terms |
| **Court e-filing maturity** | BC Supreme Court has e-filing for family | Alberta has CAOS e-filing for Court of King's Bench |
| **Law-society UPL risk** | LSBC licensed-paralegal pilot; higher scrutiny | No licensed-paralegal regime; less precedent |
| **Tax / billing complexity** | PST 7% + GST 5% (separate handling) | GST 5% only — simpler |
| **Court-rule change velocity** | BC Family Rules amended regularly | Alberta King's Bench rules relatively stable |

### 2.2 Default lean

Absent counter-evidence from scoring, **Alberta** is the lighter Phase 1 second province (simpler tax, fewer forms, no PST). **BC** is the higher-upside but higher-friction choice. Run the scoring once Ontario exits §1.

### 2.3 Pre-build deliverables for the chosen province
- Form inventory spreadsheet (every required family-law form, source URL, fillable/static, type, last-updated).
- Tax + pricing-tier proposal.
- Compliance memo (§4) for that province.
- Marketing landing-page copy variant.

---

## 3. Code generalization requirements

Before any province #2 form work lands, the codebase must be made multi-jurisdictional. Goal: **zero hardcoded `"ON"` / `"Ontario"` / `"35 forms"` references in product code** by end of phase.

### 3.1 Form registry
- [ ] Define `Jurisdiction` enum (`ON`, `BC`, `AB`, …) in shared types.
- [ ] `docs/forms/forms.json` is the seed — promote it to a registry table or authoritative JSON read by the app.
- [ ] Replace hardcoded form-count copy on landing page and pricing tiers with a value computed from the registry.
- [ ] Add per-form `version` and `last_verified_at` fields so the rule monitor can flag stale forms.

### 3.2 Rule monitor generalization
- [ ] Extract Ontario-specific URLs into `monitors/jurisdictions/ON.yaml`.
- [ ] Define a `JurisdictionMonitorConfig` schema.
- [ ] Refactor existing job to loop over enabled jurisdictions.
- [ ] Add `AB.yaml` or `BC.yaml` as the second config when province #2 is chosen.

### 3.3 Pricing + tax
- [ ] Pricing tiers become `(tier, jurisdiction)` rows, not three global tiers.
- [ ] Stripe products: one product per `(tier, jurisdiction)` or use Stripe `tax_behavior` + jurisdiction-aware tax rates.
- [ ] Checkout flow detects or asks for user's province before showing price.

### 3.4 Routing + UX
- [ ] Add jurisdiction selector to intake entry point (default: detect from IP, allow override).
- [ ] URL structure: `heartandpage.ca/on/...`, `heartandpage.ca/ab/...`.
- [ ] Disclaimers and "not legal advice" copy must be jurisdiction-scoped.

### 3.5 Data model
- [ ] Add `jurisdiction` column to user, intake, and document tables.
- [ ] Backfill all existing rows to `ON`.
- [ ] All new queries filter by jurisdiction.

**Acceptance test for §3:** Standing up a dummy jurisdiction `"TEST"` with two fake forms requires only a config file and a registry entry — no application code changes.

---

## 4. Provincial law-society compliance gates

### 4.1 Universal gates (every province)
- [ ] Plain-English "not legal advice" disclaimer on landing page, intake screens, and PDF outputs.
- [ ] No personalized recommendations on legal strategy or outcomes.
- [ ] No advertising language suggesting the user does not need a lawyer.
- [ ] Terms of Service state the product is form-preparation software, not a law firm.

### 4.2 Per-province checklist template
- [ ] Read that province's *Legal Profession Act* definition of practice of law.
- [ ] Read law society's published guidance on form-preparation software / paralegal scope.
- [ ] Confirm court-form redistribution terms (Queen's/King's Printer).
- [ ] Review PIPEDA + provincial private-sector privacy statute (BC PIPA, Alberta PIPA).
- [ ] Document data-processing path if LLM features touch user-entered personal info.

### 4.3 Province-specific notes
- **Ontario:** LSO licensed-paralegal regime comparatively well-defined. Stay on the "filling forms accurately" side of the line.
- **Alberta:** No licensed-paralegal regime. UPL definition under *Legal Profession Act* (Alberta) is broad. Extra-strict disclaimer posture.
- **British Columbia:** LSBC licensed-paralegal initiatives; higher visibility = higher scrutiny.
- **Quebec (deferred):** Civil law, French-language requirements (Bill 96), Law 25 privacy — not in Phase 1.

---

## 5. Deferred scope ("not in Phase 1")

### Geographic
- US state-by-state expansion
- European markets (UK, Ireland, EU)
- Australia / New Zealand
- Quebec
- Any province beyond #2

### Product
- Legal LLM AI for fact organization and guidance
- E-filing integrations beyond PDF export
- Lawyer/paralegal marketplace or referral product
- Native mobile apps (iOS/Android) — mobile-web only in Phase 1
- Multi-user / firm accounts

### Infrastructure
- Migration off Supabase / Railway / Netlify
- SOC 2 or ISO 27001 certification

### Commercial
- Affiliate or referral program
- Enterprise / legal-aid clinic pricing tier
- Annual subscriptions (monthly + one-time only in Phase 1)

---

## Milestone tracking

Do not start a milestone until the previous one is closed.

1. **M1 — Ontario exit criteria met** (§1)
2. **M2 — Code generalized for multi-jurisdiction** (§3)
3. **M3 — Province #2 selected and scored** (§2)
4. **M4 — Province #2 compliance memo signed off** (§4)
5. **M5 — Province #2 forms ingested into registry**
6. **M6 — Province #2 launched in Stripe + landing page**
7. **M7 — Phase 1 retrospective** → input into Phase 2 planning

---

## Decision log

Record any deviation from this plan in `decisions/` as a dated markdown file. The roadmap is the source of truth; the decision log is how it changes.
