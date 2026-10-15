# Shortlist AI Implementation Plan

**Product direction (updated):** a multi-user web app. Anyone can create an account, save their own resumes, and link **their own Anthropic API key** in Settings (with a built-in guide on how to get one). The owner hosts the app on a personal AWS account but never supplies or pays for model usage.

**UI direction:** the prototype is a behaviour and feature reference only. The new UI is a fresh, simple, clean design, not a copy of its look. Principles:
- **One task per screen, minimal chrome.** Light theme by default with a dark mode toggle (follows system preference); one accent colour, generous whitespace, readable type scale, consistent spacing, no dense card-in-card layouts.
- **Guided flow instead of one crowded page:** New Analysis is a short stepper: 1) paste the job description, 2) choose a resume, 3) review and run. Results open on their own page with clear sections.
- **Results page:** a summary header (match score ring, role, company, one-line verdict) then tabs or a sticky side nav for Cover Letter, Gaps, Tips, Tailored Resume. Long content gets a comfortable reading width; copy/download actions sit consistently at the top of each section.
- **Simple navigation:** a slim top bar or left rail with Applications, New Analysis, My Resumes, Settings, and a user menu. API key status is a small indicator that links to Settings, not a permanent bar.
- **Friendly empty, loading, and error states** everywhere (skeletons, plain-language messages, one clear next action).
- **Mobile-first responsive,** keyboard accessible, WCAG AA contrast.
- Build with a small set of shared components (Button, Input, Card, Tabs, Dialog, Toast, Badge, Stepper) in Tailwind, optionally on headless primitives (Radix UI / shadcn/ui) to keep it consistent and accessible.
- Before building screens, produce quick low-fidelity wireframes for: Sign in/up, Onboarding wizard (all 4 steps, especially the API key step with guide), New Analysis stepper, Results, My Resumes, Settings (API key guide), Applications list. Get the owner's sign-off, then implement.

## 1. What the prototype does (reviewed: `docs/reference-jobscan_pro_v3.html`)

Single HTML file, vanilla JS, dark UI. Flow:

1. User pastes an Anthropic API key (stored in `localStorage`), a JD, and picks one of 3 hardcoded resume profiles (AI Engineer, Full Stack, Tech Lead) or pastes a custom resume.
2. Five outputs, each a separate LLM call (`claude-sonnet-4-20250514`, called straight from the browser):
   - **Overview:** JSON score 0-100, label, role, company, strengths, gaps, verdict.
   - **Cover Letter:** rule-constrained prose with copy button.
   - **Gap Analysis + Resume Tips:** one JSON call feeding two tabs (gaps with severity, strengths, suggested bullets).
   - **Updated Resume:** ATS-rewritten resume plus `---CHANGES---` list (ADDED/MODIFIED/REMOVED), edit/preview toggle, TXT and HTML download (print to PDF).
   - **Resume chat assistant:** rewrite individual bullets honestly, with quick-action chips and an "apply to editor" button.
3. "Analyse JD + Generate All" runs overview, cover letter, gaps, and resume sequentially.

## 2. Problems found in the prototype (to fix, not copy)

| # | Issue | Fix in v4 |
|---|---|---|
| 1 | API key pasted into a top bar, kept in browser `localStorage`, and used with `anthropic-dangerous-direct-browser-access` | Account system; each user links their own key in Settings; key is validated, KMS-encrypted server-side, and never returned to the browser; calls made from Lambda |
| 2 | LLM output and user text injected via `innerHTML` (XSS, and `onclick` strings with `encodeURIComponent` hacks) | React rendering only, no raw HTML |
| 3 | JD/resume silently truncated (`substring(0,2000)`) so long resumes lose content | Token-aware limits with a visible warning |
| 4 | Fragile "return ONLY JSON" + regex fence stripping; fallback dumps raw text | Tool-use structured output + Zod validation + one retry |
| 5 | Sequential calls (slow, ~4 round trips plus a metadata call) | Parallel pipeline; extract role/company once and reuse |
| 6 | Three resume profiles and the name hardcoded in source (PII in the file) | No built-in resumes. Each user uploads multiple resumes (PDF, DOCX, TXT) or pastes text from their Resumes page; stored per user, editable, name comes from the profile |
| 7 | No persistence: refresh loses everything | Saved applications with history, status, and re-open |
| 8 | Resume change list parsed from free text | Structured `changes[]` in the response |
| 9 | Chat "apply" appends text to the bottom of the editor | Diff-style apply: replace the exact original bullet |
| 10 | PDF via browser print of a downloaded HTML | Real PDF and DOCX export (server-side or client `@react-pdf/renderer` / `docx`) |
| 11 | Hardcoded outdated model ID, no error/rate-limit handling, `sandboxMsg` workaround code | Model ID in config, typed errors, retry/backoff, loading and error states |
| 12 | Hardcoded name in prompts; no onboarding or guidance for getting a key | Name read from profile; first-run onboarding with a step-by-step key guide |

## 3. Improvements (beyond parity)

**Core quality**
- Keyword matching panel: JD keywords found / missing in resume, computed deterministically (not just LLM opinion) plus LLM semantic match.
- Score breakdown (skills, experience level, domain, keywords) rather than one opaque number.
- Honesty guard: post-generation check that flags any employer, date, cert, or tech in the output that is absent from the source resume.
- Side-by-side diff view of original vs tailored resume with accept/reject per change.
- Multiple resume versions per application; prompt to pick the best base profile automatically (rank profiles against the JD).

**Workflow**
- Job tracker: saved applications with company, role, URL, status (Saved, Applied, Interview, Offer, Rejected), notes, dates, and the generated artefacts attached.
- Import JD from URL (server-side fetch with SSRF guard) as a later phase.
- Interview prep: likely questions and STAR-story suggestions from the gap analysis.
- Streaming responses so tabs fill in progressively.

**Resume library (new core requirement)**
- "My Resumes" page: upload multiple resumes per account (PDF, DOCX, TXT; drag and drop; max 5 MB each, max 10 per user), or paste text.
- Each resume has a label (e.g. "AI Engineer", "Full Stack"), optional notes, default flag, created/updated dates, and can be renamed, edited, duplicated, downloaded (original), or deleted.
- Upload flow: browser gets a presigned S3 URL, uploads the file, a Lambda extracts text (PDF via `unpdf`/`pdf-parse`, DOCX via `mammoth`, TXT as-is) and saves it. The user then sees the **extracted text in an editor to review and fix** before it is used, because parsing can mangle layouts.
- Warnings: scanned/image-only PDFs yield no text (no OCR in v1; show "paste text instead"), very long resumes show a token-limit notice, password-protected files are rejected with a clear message.
- Generated tailored resumes can be saved back into the library as a new resume ("Save as new version"), linked to the source and the application.
- The Generate screen's Resume dropdown lists the user's resumes, with a link to upload one if empty. Onboarding is covered by the wizard below (key first, then resume).

**Accounts and BYOK (new core requirement)**
- Self sign-up with email verification, login, forgot password, delete account.
- Settings page: link / test / replace / remove Anthropic key, masked display (`sk-ant-...XXXX`), model choice from an allow-list, and an inline "How to get your API key" guide (steps below).
- **Onboarding wizard right after sign-up and email verification:** Welcome -> Add API key (with the guide inline, required) -> Add first resume (skippable) -> Done. Key linking is a mandatory part of onboarding, not an afterthought in Settings.
- Status banner afterwards if the key later becomes invalid; generation stays disabled until a valid key exists, with clear errors for invalid key, no credit, and rate limits.
- Optional later: show approximate token usage/cost per run so users see what their key spends.

**Platform**
- Abuse and cost guardrails: per-user daily request cap, request size limits, throttling, budget alert (owner pays only AWS infra; Anthropic usage is on each user's key).
- Observability: CloudWatch dashboard (latency, token usage, error rate), X-Ray tracing.
- Export: PDF, DOCX, TXT; copy-to-clipboard everywhere.

## 4. Architecture

```
Browser (React SPA) --> CloudFront --> S3 (static assets)
        |
        | HTTPS + Cognito JWT
        v
API Gateway (HTTP API, JWT authorizer, throttling)
        |
   Lambda (Node 22)  ----> Anthropic API (api.anthropic.com, using the caller's own key)
        |
        +----> DynamoDB (single table)
        +----> KMS CMK (encrypt/decrypt stored API keys)
        +----> S3 (exports)
   Step Functions (Express) or parallel Promise.all in one Lambda for "generate all"
```

Decision: start with `POST /analyses` creating a record and running overview, cover letter, gaps, and resume as **parallel Lambda invocations / Step Functions Map**, with the UI polling `GET /analyses/{id}` (or SSE later). Chat uses a separate synchronous `POST /chat`. Simpler fallback for Phase 2: one Lambda doing `Promise.all`, keeping within API Gateway's 30s limit by using async (202 + poll) from the start.

### DynamoDB single table (`PK`, `SK`, GSI1)

| Entity | PK | SK |
|---|---|---|
| User profile | `USER#<sub>` | `PROFILE` (name, default model, daily quota counters, `onboardingStep`, `onboardingCompletedAt`) |
| Anthropic key | `USER#<sub>` | `SECRET#anthropic` (ciphertext, `lastFour`, `validatedAt`) |
| Resume | `USER#<sub>` | `RESUME#<id>` (label, extracted text, `sourceS3Key`, mime, size, `isDefault`, `parentResumeId?`, timestamps) |
| Application | `USER#<sub>` | `APP#<ts>#<id>` |
| Analysis artefact | `APP#<id>` | `ART#overview` / `cover` / `gaps` / `resume` |
| Chat message | `APP#<id>` | `CHAT#<ts>` |

GSI1 on application status for the tracker board.

### API (all JWT-protected)

```
GET    /me                        profile + key status
PUT    /me                        name, model choice
DELETE /me                        delete account + all data
GET    /settings/api-key          { configured, lastFour, validatedAt }  (never the key)
PUT    /settings/api-key          { apiKey } validate (format + live call), encrypt, store
POST   /settings/api-key/test     re-check stored key
DELETE /settings/api-key
GET    /resumes                   list (metadata only)
POST   /resumes                   { label, text }  paste-text create
POST   /resumes/upload-url        { filename, contentType, size } -> presigned S3 PUT + resumeId
GET    /resumes/{id}              metadata + extracted text (+ status: processing|ready|failed)
PUT    /resumes/{id}              label, text edits, isDefault
GET    /resumes/{id}/original     presigned download URL for the uploaded file
DELETE /resumes/{id}              removes record and S3 object
POST   /applications              { jd, resumeId, url? }  -> 202 { id }
GET    /applications              list, filter by status
GET    /applications/{id}         record + artefacts + status per artefact
PATCH  /applications/{id}         status, notes
POST   /applications/{id}/regenerate/{artefact}
POST   /applications/{id}/chat    { message, bulletRef? }
POST   /applications/{id}/export  { format: pdf|docx|txt } -> presigned URL
```

### CDK stacks

- `AuthStack`: User Pool (self sign-up enabled, email verification required, password policy, optional MFA), app client (SPA, PKCE), post-confirmation trigger to create the profile record.
- `DataStack`: DynamoDB (PITR, retain), private uploads bucket (SSE-S3/KMS, block public access, CORS for the web origin only, 7-day lifecycle on unconfirmed uploads), S3-event Lambda for text extraction, KMS CMK for API keys (rotation on, retain), exports bucket (private, lifecycle 30d).
- `ApiStack`: HTTP API, JWT authorizer, Lambdas (`NodejsFunction`), IAM for DynamoDB and scoped `kms:Decrypt`, throttling, log retention, alarms.
- `WebStack`: S3 + CloudFront (OAC, SPA 403/404 -> index.html, response headers policy), `BucketDeployment`, runtime `config.json` with API URL and Cognito IDs.
- `PipelineStack` (optional later): Step Functions for generation.

## 5. Phases

Each phase ends with something deployable and tested. Tick tasks as done.

### Phase 0 - Foundations
- [x] UX: wireframes for the key screens in `docs/wireframes/index.html` (open in a browser). **Awaiting owner sign-off** on layout and design tokens before building UI.
- [x] Monorepo (npm workspaces), strict TypeScript base config, ESLint, Prettier, Vitest.
- [x] Scaffold `apps/web` (Vite 7 + React 18 + Tailwind 4), `apps/api`, `packages/shared`, `infra` (CDK, placeholder stack).
- [x] `git init`, `.gitignore`, project `.npmrc` pinning the public npm registry (global npm config points at an expired work CodeArtifact registry).
- [x] Verified: `npm run typecheck`, `lint`, `test` (10 passing), `build`, `synth` all pass; `npm audit` clean.
- [ ] Default Claude model ID and user allow-list (decide when building Phase 3; check current Anthropic model names then).
- [ ] **Deferred by owner (do manually later):** AWS profile `shortlist-ai-personal`, `cdk bootstrap`, AWS Budget alert (USD 10). Nothing is deployed yet; `cdk synth` needs no credentials.
- [ ] First commit (waiting for owner go-ahead).
- Exit: scaffold builds and tests green (done); wireframes approved (pending).

### Phase 1 - Static hosting + accounts
- [x] `WebStack` (S3 + CloudFront) and `AuthStack` (Cognito with self sign-up).
- [x] Frontend auth screens: sign up, verify email code, login, forgot/reset password, logout; protected routes. (App shell, nav, user menu, design tokens, light/dark theme, shared components: done.)
- [ ] Post-confirmation Lambda creating the user profile; `GET/PUT/DELETE /me`.
- [ ] First `cdk deploy`; verify a fresh user can sign up and log in on the CloudFront URL.
- Exit: anyone can create an account and see an empty app shell.

### Phase 1b - Onboarding wizard + BYOK key linking
- [ ] `KMS` key, `PUT/GET/DELETE /settings/api-key` and test endpoint; format check + live validation call; envelope encryption; last-4 only returned.
- [ ] Settings page with masked input, Save / Test / Replace / Remove, status badge, model picker.
- [ ] Inline guide "How to get your Anthropic API key" (steps in CLAUDE.md), "Get key" link, privacy note.
- [ ] Onboarding wizard (Welcome -> API key -> first resume -> Done; the resume step is a placeholder until Phase 2 delivers the resume library) with the key guide inline in the key step; progress persisted on the profile (`onboardingStep`, `onboardingCompletedAt`); route guard redirects non-onboarded users to the wizard.
- [ ] Settings reuses the same key form component for replace/remove; banner in app shell if the key later becomes invalid.
- [ ] E2E test: sign up, verify, complete wizard with a mocked valid key, land on New Analysis; wizard cannot be finished with an invalid key.
- [ ] Tests: key never appears in any response or log; user A cannot access user B's key; invalid/401/no-credit mapping to friendly errors.
- Exit: a new user signs up, is taken straight into onboarding, follows the guide, links a verified key, and reaches New Analysis.

### Phase 2 - Resume library + data layer
- [ ] `DataStack`, repo layer, Zod schemas in `shared`.
- [ ] Resume API: list/create/update/delete, paste-text create, presigned upload URL, original download URL.
- [ ] Extraction Lambda (S3 event): PDF/DOCX/TXT to text, status field (`processing` -> `ready`/`failed`), size/type validation using magic bytes not just the extension, user-scoped S3 keys `uploads/<sub>/<resumeId>/<filename>`.
- [ ] "My Resumes" UI: drag-and-drop multi-upload with progress, list with labels and default badge, text review/edit screen, rename/duplicate/delete, empty state and onboarding step.
- [ ] Tests: extraction fixtures (text PDF, DOCX, scanned PDF, corrupt file, oversize), user isolation on S3 keys and DB, CDK assertions for bucket policy and IAM scoping.
- Exit: a user uploads two or more resumes in the deployed app, corrects the extracted text, and sets a default.

### Phase 3 - AI core (parity with prototype)
- [ ] `LlmProvider` interface + Anthropic SDK implementation using the caller's decrypted key, forced-tool structured output, retry/backoff, token usage recorded per run (no content logged).
- [ ] Prompts ported and improved: overview, cover letter, gaps/tips, tailored resume with structured `changes[]`.
- [ ] `POST /applications` async generation (parallel), status polling, per-artefact error and regenerate.
- [ ] UI: New Analysis stepper (JD, resume, review/run) and Results page per the UI direction; accessible tabs, score ring, gap/strength lists, copy button, loading skeletons.
- [ ] Unit tests: prompt builders, Zod validation, label-from-score, honesty-rule fixtures; mocked Anthropic client for handler tests.
- Exit: paste a JD, get all five outputs persisted and viewable after refresh.

### Phase 4 - Resume editor, chat, export
- [ ] Editor with edit/preview, structured change list, diff view and accept/reject.
- [ ] Chat assistant with bullet targeting and replace-in-place apply.
- [ ] Export TXT, DOCX, PDF with ATS-clean formatting; filename pattern from the prototype.
- Exit: full prototype feature parity plus persistence.

### Phase 5 - Tracker and quality features
- [ ] Application list/board with statuses, notes, search.
- [ ] Deterministic keyword matcher + score breakdown + honesty guard.
- [ ] Auto-suggest the best of the user's uploaded resumes for a JD (rank all, show reasons).
- [ ] Interview prep artefact.
- Exit: usable as the daily job-search tool.

### Phase 6 - CI/CD, hardening, polish
- [ ] GitHub Actions: lint, typecheck, test, `cdk synth` on PR; `cdk deploy` on main via OIDC role.
- [ ] Per-user rate cap, API throttling, abuse protection for public sign-up (email verification, optional WAF/CAPTCHA), CloudWatch dashboard + alarms, X-Ray.
- [ ] CSP/security headers verified, dependency audit, Playwright smoke test against deployed URL.
- [ ] Privacy policy / terms page, data export, account deletion tested end to end.
- [ ] Optional: custom domain (Route 53 + ACM), WAF (note cost), JD import from URL.
- Exit: push-to-deploy pipeline, monitored, documented in README.

## 6. Open decisions for the owner

1. **Key storage:** plan uses KMS envelope encryption in DynamoDB (cheap). Secrets Manager per user would cost about USD 0.40/secret/month, so it is not recommended at scale.
2. **Region.** `ap-southeast-2` (Sydney) for latency and data residency; users are mostly in Australia. Confirm.
3. **Custom domain** now or later (Route 53 hosted zone costs about USD 0.50/month plus domain).
4. **Auth UX:** decided - in-app forms (Amplify Auth) so sign-up and the key onboarding feel like one product.
5. **Generation orchestration:** Step Functions (visible, retryable, more infra) vs single async Lambda (simpler). Default: async Lambda, revisit if it gets complex.
6. **Public vs invite-only sign-up:** plan assumes open sign-up with email verification and rate limits. Invite-only is a one-line Cognito change if you prefer to limit exposure.
7. **Social login** (Google) later? Cognito supports it; skipped for v1.

## 7. Estimated running cost

Owner: S3/CloudFront/Lambda/API Gateway/DynamoDB/Cognito are near zero at small scale, plus about USD 1/month for the KMS key. Anthropic token costs are paid by each user through their own key (roughly a few cents per full "generate all" run, depending on model). Budget alert and rate limits protect the owner from abuse.
