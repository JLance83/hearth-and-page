# Auto-fill System

## Purpose

When a user fills out Form 8 (Application — General) first, their courthouse, file number, both party names, contact details, marriage date, and separation date are automatically carried forward to every subsequent form in the same case. They type it once — it follows them through the entire matter.

## How It Works

Each field in a form schema can have an `autoFill` property:

```json
{
  "id": "applicant_full_name",
  "label": "Applicant's full legal name",
  "type": "text",
  "autoFill": "applicant_full_name"
}
```

When the FormEngine saves an answer to a field with `autoFill`, it stores it under both the field ID and the auto-fill key. When any other form loads a field with the same `autoFill` key, it pre-populates with the stored value.

## Standard Keys

| autoFill Key | Meaning |
|---|---|
| `courthouse` | Court location (courthouse name/city) |
| `court_file_number` | Case file number assigned by the court |
| `applicant_full_name` | Full legal name of the person starting the case |
| `respondent_full_name` | Full legal name of the other party |
| `marriage_date` | Date of marriage (ISO format) |
| `separation_date` | Date of separation (ISO format) |
| `user_address` | Applicant's address for service |
| `user_phone` | Applicant's telephone number |
| `user_email` | Applicant's email address |
| `user_dob` | Applicant's date of birth |

## Coverage (as of June 2026)

| Form | Auto-fill Fields |
|---|---|
| Form 8 | 10 (seeds all standard keys) |
| Form 10 | 8 |
| Form 13.1 | 6 |
| Form 13B | 9 |
| Form 14 | 7 |
| Form 14A | 5 |
| Form 14B | 4 |
| Form 15 | 4 |
| Form 15A | 4 |
| Form 15C | 6 |
| Form 17 | 4 |
| Form 17E | 4 |
| Form 23C | 7 |
| Form 25 | 6 |
| Form 25A | 6 |
| Form 26B | 7 |
| Form 35.1 | 6 |
| Form 36 | 6 |
| Form 4 | 10 |
| Form 6B | 4 |
