# Resume library

Phase 2. Each user keeps up to 10 resumes of their own, with no built-in or sample data. This page covers the storage, the API (paste-text create, edit, default, duplicate, delete) and the My Resumes screens. Uploading files (PDF, DOCX, TXT) is documented when it lands. The term for a user's set of resumes is **Resume library** (see GLOSSARY.md); "My Resumes" is the screen.

## What a resume holds

| Field | Notes |
|---|---|
| `label` | 1 to 80 characters, for example "AI Engineer" |
| `notes` | Optional, up to 500 characters |
| `text` | The resume text, 20 to 60,000 characters. The source of truth for prompts |
| `status` | `processing`, `ready` or `failed`. Pasted resumes are `ready` immediately. Uploads (next slice) start as `processing` |
| `source` | `paste` or `upload` |
| `wordCount` | Computed by the server on each read, for the list. The text itself is never in the list |
| `isDefault` | Exactly one resume is the default, once the user has any |
| `reviewed` | False until the user has seen and accepted the text. Always true for pasted resumes. Editing the text, or confirming it, sets it |
| `parentResumeId` | Reserved for tailored versions saved back to the library |

Text over the limit is **rejected with a message**, never truncated. The 60,000 character cap (about 15,000 tokens, many times the length of a normal resume) also keeps each item well under DynamoDB's 400 KB limit, even with multi-byte characters.

## API

All routes need the Cognito ID token. Items live under `pk = USER#<sub>`, `sk = RESUME#<id>`, so every read and write is scoped to the caller.

| Method | Path | Body | Result |
|---|---|---|---|
| GET | `/resumes` | none | `{ resumes: [...] }` metadata only (no text), most recently updated first |
| POST | `/resumes` | `{ label, text, notes? }` | 201 with the full resume. 409 `limit_reached` at 10 |
| GET | `/resumes/{id}` | none | The full resume with text, or 404 |
| PUT | `/resumes/{id}` | Any of `label`, `notes`, `text`, `isDefault: true`, `reviewed: true`. No other fields | The updated resume, 400 or 404 |
| DELETE | `/resumes/{id}` | none | 204, or 404 |
| POST | `/resumes/{id}/duplicate` | none | 201 with the copy ("<label> (copy)", not default). 409 at 10 |

Errors are `{ "error": { "code", "message" } }`. A resume that belongs to someone else is indistinguishable from one that does not exist (404).

## Screens

| Route | What it does |
|---|---|
| `/resumes` | The library. Each row shows the label, a **Default** badge, `Pasted · Updated 3 Oct · 1,400 words`, any notes, and a row menu: Edit text, Rename, Duplicate, Set as default, Delete. The header shows "N of 10 used". Empty state: "No resumes yet" with an add button |
| `/resumes/new` | Add a resume by pasting text: label, optional notes, text. The first resume becomes the default, and the page says so |
| `/resumes/{id}` | Edit label, notes and text with the same form |

How it behaves:

- **Limit:** at 10 of 10, "Add resume" and "Duplicate" are disabled with the message "Delete one to add another". The server enforces it too.
- **Character count:** the editor shows `N / 60,000 characters` live. Over the limit, a message says by how many characters, and saving is refused. The text is never truncated.
- **Edits send only what changed.** Renaming does not resend the text, and only a text change marks the resume reviewed.
- **Unsaved changes:** leaving the editor by any route (sidebar, Cancel, browser back) asks "Discard your changes?" while the form has edits, and closing the tab triggers the browser prompt. After a successful save it does not ask. This needs a data router, so the app mounts under `createBrowserRouter` with a single splat route that holds the existing `<Routes>`.
- **Delete** asks first. If the resume is the default, the dialog names the resume that will become the default (the most recently updated remaining one, matching the server rule).
- **Onboarding:** the wizard's resume step uses the same form (without notes). See [Onboarding wizard](onboarding.md).

## Rules

- **Limit:** 10 resumes per user. Create and duplicate both check it. The check is not atomic, so two simultaneous requests could briefly exceed it. That is harmless and bounded by the API throttle.
- **Default:** the first resume becomes the default. Choosing another clears the old default in one transaction, so there is never more than one. Deleting the default promotes the most recently updated remaining resume. `isDefault` can only be set to `true`.
- **Ownership:** the user ID comes only from the token. Ids in paths must be UUIDs, and anything else is a 404.
- **Body size:** requests over 250 KB are rejected.
- **Privacy:** logs contain error class names and IDs only, never resume text, labels or notes.
- **Deleting an account** removes every item under the user's partition, resumes included. Uploaded files are added to that flow in the upload slice.

## Infrastructure

Six functions, one per route, sharing one handler (`apps/api/src/handlers/resumes.ts`) and each holding only the DynamoDB actions its code path needs:

| Function | Actions |
|---|---|
| `ListResumes` | `Query` |
| `GetResume` | `GetItem` |
| `CreateResume` | `Query`, `PutItem` |
| `DuplicateResume` | `GetItem`, `Query`, `PutItem` |
| `UpdateResume` | `GetItem`, `Query`, `UpdateItem` (the default switch is a transaction of updates) |
| `DeleteResume` | `GetItem`, `Query`, `DeleteItem`, `UpdateItem` |

None can scan the table, use KMS or call Cognito. No new resources: the table is the Phase 1 single table.

## Code layout

- `packages/shared/src/resume.ts`: schemas, limits and request types, shared with the web app.
- `apps/api/src/repo/resumeRepo.ts`: DynamoDB access. `services/resumeService.ts`: limits, default handling, reviewed state. `handlers/resumes.ts`: routing.

## Tests

- **Web:** the list (empty state, rows, word counts, limit, set default, rename, duplicate, delete with the new default named, errors and retry), the add and edit screens (validation, live count, over-limit refusal, changed-fields-only updates, server errors, not found) and the unsaved-changes guard (sidebar, Cancel, Keep editing, Discard, no prompt when clean or after saving).
- **Validation:** missing, blank and over-long labels, short and over-long text, unknown fields (including `userId` and `status`), malformed JSON, oversized bodies; text at exactly the limit is accepted.
- **Limit:** ten allowed, the eleventh and a duplicate refused with a clear message, a slot freed by deleting, and one user's library not counting against another's.
- **Isolation:** user B cannot list, read, change, set as default, duplicate or delete user A's resume, and A's data is unchanged afterwards; a default change for A does not touch B.
- **Default:** switching leaves exactly one; setting it again is harmless; deleting the default promotes another; deleting the last resume leaves an empty library, and the next one becomes the default.
- **Other:** the listing never includes text; editing text marks it reviewed; malformed ids are 404; duplicate keeps labels within 80 characters; resume text is never logged.
- **CDK:** all routes behind the authorizer, list and get are read-only, only `DeleteResume` among the resume functions can delete, none can scan or touch KMS or Cognito.
