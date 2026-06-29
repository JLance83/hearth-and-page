# Ontario Forms Registry

All forms are based on the Ontario Family Law Rules (O. Reg. 114/99).  
Source: [Ontario Court Forms](https://ontariocourtforms.on.ca/en/family-law-rules-forms/)

| Form | Title | formCode | hp-patches key | Revised | Status |
|---|---|---|---|---|---|
| 4 | Notice of Change in Representation | `form4-change-representation` | `ON-F4` | June 13, 2025 | ✅ Live |
| 6B | Affidavit of Service | `form6b-affidavit-service` | `ON-F6B` | April 12, 2016 | ✅ Live |
| 8 | Application (General) | `form8-general` | `ON-F8` | June 13, 2025 | ✅ Live |
| 10 | Answer | `form10-answer` | `ON-F10` | June 13, 2025 | ✅ Live |
| 13 | Financial Statement (Support Claims) | `form13-financial` | (tile catalog) | May 1, 2021 | ✅ Live |
| 13.1 | Financial Statement (Property & Support) | `form13_1-property` | `ON-F13_1` | May 1, 2021 | ✅ Live |
| 13B | Net Family Property Statement | `form13b-net-family-property` | `ON-F13B` | May 15, 2009 | ✅ Live |
| 14 | Notice of Motion | `form14-motion` | `ON-F14` | March 1, 2018 | ✅ Live |
| 14A | Affidavit (General) | `form14a-affidavit` | `ON-F14A` | Sept 1, 2005 | ✅ Live |
| 14B | Motion Form | `form14b-motion-form` | `ON-F14B` | Sept 1, 2021 | ✅ Live |
| 15 | Motion to Change | `form15-motion-to-change` | `ON-F15` | Sept 1, 2021 | ✅ Live |
| 15A | Change Information Form | `form15a-change-info` | `ON-F15A` | (retired 2020) | ⚠️ Legacy |
| 15C | Consent Motion to Change | `form15c-consent-change` | `ON-F15C` | Dec 1, 2020 | ✅ Live |
| 17 | Conference Notice | `form17-conference-notice` | `ON-F17` | Nov 1, 2018 | ✅ Live |
| 17E | Trial Management Conference Brief | `form17e-trial-brief` | `ON-F17E` | Sept 1, 2023 | ✅ Live |
| 23C | Affidavit for Uncontested Trial | `form23c-uncontested-trial` | `ON-F23C` | Dec 1, 2020 | ✅ Live |
| 25 | Order (General) | `form25-order-general` | `ON-F25` | Dec 1, 2020 | ✅ Live |
| 25A | Divorce Order | `form25a-divorce-order` | `ON-F25A` | Sept 1, 2005 | ✅ Live |
| 35.1 | Affidavit (Decision-making, Parenting, Contact) | `form35_1-custody-affidavit` | `ON-F35_1` | Sept 1, 2021 | ✅ Live |
| 36 | Affidavit for Divorce | `form36-divorce` | `ON-F36` | April 1, 2024 | ✅ Live |

## Notes

- **Form 15A** was retired in the December 2020 Family Law Rules reforms. It has been replaced functionally by Forms 15B, 15C, and 15D. Our Form 15A schema remains for backward compatibility but should be reviewed.
- **Form 13** is registered in the tile/caseType system rather than as a standalone `__hp_formDefs` entry. It renders through the existing Financial Statement UI.
- All form schemas are stored in `/form-engine/ON/` as JSON files and injected into `hp-patches.js` at build time.
