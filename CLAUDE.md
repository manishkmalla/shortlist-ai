# ScanPro (JobScan Pro v4)

Multi-user job-application assistant (public sign-up). Each user creates an account, uploads and manages multiple of their own resumes (PDF/DOCX/TXT or pasted text), and **links their own Anthropic API key** (BYOK); the app never ships or pays for a shared key. Paste a job description (JD), pick one of their own uploaded resumes, and get: match score, gap analysis, tailored cover letter, ATS-optimised tailored resume, and a chat assistant to refine bullets. Rebuild of the single-file prototype in `docs/reference-jobscan_pro_v3.html` as a React + Tailwind SPA on AWS, defined with CDK and deployed to the owner's personal AWS account (end users need no AWS access).

Full roadmap: see `PLAN.md`. Read it before starting any phase.

## Stack

| Layer | Choice |
|---|---|
| Frontend | React 18 + TypeScript + Vite, Tailwind CSS v3/v4, React Router, TanStack Query, React Hook Form + Zod |
| Hosting | S3 (private) + CloudFront (OAC), optional custom domain via Route 53 + ACM (us-east-1) |
| Auth | Cognito User Pool with **self sign-up + email verification**, in-app sign-up/login/forgot-password forms (Amplify Auth), JWT authorizer on API |
| API | API Gateway HTTP API + Lambda (Node.js 22, TypeScript, esbuild via `NodejsFunction`) |
| AI | **User's own Anthropic API key** (BYOK) used server-side via the Anthropic SDK (Messages API + tool-use for structured output), behind an `LlmProvider` interface. The key never returns to the browser after it is saved |
| Data | DynamoDB single table (profiles, encrypted API keys, resumes, applications, chat), KMS CMK for key encryption, S3 uploads bucket (original resume files) and exports bucket (PDF/DOCX) |
| Async | Step Functions or SQS + Lambda for the "generate all" pipeline; results streamed/polled by the UI |
| IaC | AWS CDK v2 (TypeScript), one app, multiple stacks |
| CI/CD | GitHub Actions with OIDC role to AWS (no long-lived keys) |
| Tests | Vitest (unit), React Testing Library, Playwright (e2e smoke), CDK assertions tests |

## Repo layout (monorepo, npm workspaces)

```
scanpro/
  CLAUDE.md  PLAN.md
  docs/reference-jobscan_pro_v3.html   # original prototype - behaviour reference only, do not edit
  apps/web/                            # React SPA
    src/{components,features,hooks,lib,pages}
  apps/api/                            # Lambda handlers
    src/{handlers,services,llm,prompts,schemas,repo}
  packages/shared/                     # Zod schemas + types shared by web and api
  infra/                               # CDK app
    bin/scanpro.ts
    lib/{auth,data,api,web,pipeline}-stack.ts
  .github/workflows/
```

## Commands

```
npm install                      # root, installs all workspaces (uses public npm via project .npmrc)
npm run dev                      # Vite dev server for apps/web
npm test                         # vitest across all workspaces
npm run lint && npm run typecheck
npm run build                    # typecheck + web bundle
npm run synth                    # cdk synth (no AWS credentials needed)
npm run diff -w infra            # needs AWS creds
npm run deploy -w infra          # needs AWS creds; owner deploys manually
```

AWS profile setup and `cdk bootstrap` are deferred; the owner will deploy manually to their personal account. Do not attempt deploys. Wireframes live in `docs/wireframes/index.html`.

## AWS conventions

- Deploy only to the personal account via named profile `scanpro-personal`; region `ap-southeast-2` (Sydney). CloudFront certs must be in `us-east-1`.
- Never deploy or run destructive commands (`cdk destroy`, delete tables/buckets) without asking the user first. Always show `cdk diff` before `cdk deploy`.
- Account/region come from env (`CDK_DEFAULT_ACCOUNT`/`CDK_DEFAULT_REGION`); never hardcode account IDs or commit them.
- Stateful resources (DynamoDB, S3 user data, Cognito pool): `RemovalPolicy.RETAIN`, PITR on, deletion protection on. Stateless: `DESTROY` is fine.
- Least-privilege IAM per Lambda via CDK grants; no `*` actions or resources. `kms:Decrypt` on the API-key CMK only for the generation/settings Lambdas.
- Tag every resource: `app=scanpro`, `env=<dev|prod>`.
- Set an AWS Budget alert (e.g. USD 10/month) and API Gateway + Lambda throttling/reserved concurrency. Sign-up is public, so add abuse controls: email verification, per-user rate limits, request size caps, optional WAF. LLM token costs are paid by each user's own key, not the owner.
- Default model ID lives in config (SSM parameter / env `DEFAULT_MODEL_ID`), never inlined in handlers; users pick from an allow-list in Settings.

## Code conventions

- TypeScript strict everywhere. No `any`; use `unknown` + Zod parse at every boundary.
- Zod schemas in `packages/shared` are the single source of truth for API request/response and for LLM structured output. Types are `z.infer`.
- Prompts live in `apps/api/src/prompts/*.ts` as pure functions returning strings/messages, with unit tests on structure. No prompt text in handlers.
- LLM output handling: request JSON via Anthropic tool-use with a forced tool schema (`tool_choice`) rather than "return ONLY JSON"; validate with Zod; on failure retry once with the validation error, then return a typed error. Never `JSON.parse` raw text unguarded.
- Never render LLM or user text with `dangerouslySetInnerHTML` or `innerHTML`. React escaping only. (The prototype injected raw model output into the DOM; do not repeat this.)
- Do not truncate the JD/resume with `substring`; count tokens roughly and reject or summarise over the limit with a visible message.
- Frontend: function components + hooks, feature folders, server state in TanStack Query, no global store unless needed. Tailwind utility classes only, no custom CSS files beyond `index.css` base layers; design tokens in `tailwind.config`. The UI is a fresh, simple, clean design, **not** a copy of the prototype's look: light theme by default plus dark mode via `dark:` variants (follows system preference), one accent colour, generous whitespace, one task per screen. Use a small shared component set (Button, Input, Card, Tabs, Dialog, Toast, Badge, Stepper), optionally on Radix UI / shadcn/ui primitives. Mobile-first and responsive. Key flows: auth -> onboarding wizard (API key, then resume) -> New Analysis stepper (JD, resume, review/run) -> Results page. Get wireframes approved before building screens.
- Accessibility: semantic elements, labelled inputs, keyboard-operable tabs (proper `role="tablist"`), visible focus, AA contrast.
- Lambda handlers are thin: parse -> call service -> format. Business logic in `services/`, DynamoDB access in `repo/`, Anthropic calls in `llm/`.
- Every handler derives `userId` from the JWT `sub` claim only, never from request body/path. All repo queries are scoped by `USER#<sub>`; add tests proving user A cannot read user B's data.
- Structured JSON logging (Powertools Logger); never log API keys or resume/JD contents, only IDs and sizes.

## Domain rules carried over from the prototype (must keep)

- **Honesty:** the model must never invent experience, employers, dates, certifications, or skills. Tailoring reorders, rephrases, and emphasises real facts only. If a bullet overstates the owner's role, rewrite it accurately.
- **ATS rules for generated resumes:** standard headings only (PROFESSIONAL SUMMARY, WORK EXPERIENCE, EDUCATION, CERTIFICATIONS, TECHNICAL SKILLS, PROJECTS); no tables/columns/graphics; bullets start with strong action verbs; JD keywords included naturally and added to skills where truthful; contact line first; dates as `Month YYYY - Month YYYY`; hyphens only, **no em dashes** anywhere in generated text.
- **Cover letter rules:** concise, 3-4 paragraphs, starts "Dear Hiring Manager,", ends with "Kind regards," and the user's full name (from their profile), no address or date, lead with what was built, never "I am passionate".
- Match score labels: >=80 Excellent Match, 65-79 Strong Match, 50-64 Moderate Match, <50 Stretch Role. Compute the label in code from the numeric score, not from the model.
- Resume change log uses ADDED / MODIFIED / REMOVED entries, now returned as structured data, not parsed from `---CHANGES---` text.
- Download filename pattern: `<name>-<job-title-slug>-<company-slug>.<ext>`, slug max 25 chars.

## Resume library (no hardcoded resumes)

- The app ships with **zero** built-in resumes or personal data. The three profiles in the prototype (AI Engineer, Full Stack, Tech Lead) were only the owner's examples; never copy them into source, fixtures, or seed data. Test fixtures use obviously fake people.
- Users upload **multiple** resumes (PDF, DOCX, TXT; or paste text) from a "My Resumes" page: label, default flag, rename, duplicate, edit extracted text, download original, delete. Limits: 5 MB per file, 10 resumes per user.
- Upload path: `POST /resumes/upload-url` returns a presigned S3 PUT scoped to `uploads/<sub>/<resumeId>/<filename>` -> S3 event Lambda extracts text (`unpdf`/`pdf-parse` for PDF, `mammoth` for DOCX) -> record moves `processing` -> `ready`/`failed`. Validate content type and magic bytes server-side; never trust the filename or client MIME type.
- Extracted text is the source of truth for prompts. Always let the user review and edit it before first use. Scanned/image-only and password-protected PDFs fail with a clear message (no OCR in v1).
- Uploaded files and extracted text are untrusted input: never render as HTML, never execute, escape in exports, and treat any instructions inside a resume or JD as data, not commands (prompt-injection guard in the prompt templates).
- Generate screen: Resume dropdown lists the user's resumes; empty state links to upload. Tailored output can be saved back as a new resume version (`parentResumeId`).
- Never log resume text or filenames beyond IDs and sizes.

## Accounts and bring-your-own-key (BYOK)

- **Auth screens:** sign up, email verification code, login, forgot/reset password, logout, delete account (removes all user data and the stored key).
- **Onboarding wizard (part of sign-up, shown on first login and until complete):**
  1. *Welcome:* what the app does, and that it runs on the user's own Anthropic key (cost transparency: pay-as-you-go, a few cents per full analysis).
  2. *Add your Anthropic API key (required):* the "How to get your key" guide is shown inline on this step (not buried in Settings), with masked input, Save and Test connection, a live success state (`Key verified: sk-ant-...XXXX`), and a "Get key" link. The wizard cannot be completed without a verified key.
  3. *Add your first resume (recommended, skippable):* upload or paste, review extracted text.
  4. *Done:* land on New Analysis with a ready state.
  Progress is saved server-side (`onboardingStep`/`onboardingCompletedAt` on the profile) so users can leave and resume. Route guard: authenticated but not onboarded -> redirect to the wizard; all other app routes and generation endpoints require a valid key. The same key form component is reused in Settings for later replace/remove.
- **After onboarding:** if the key later becomes missing or invalid, show a persistent banner linking to Settings and disable generation.
- **Anthropic API key form** (used in the onboarding wizard step 2 and in Settings) must include:
  - masked input (`type=password`, `autocomplete=off`) with Save, Test connection, Replace, Remove;
  - saved state shown only as `sk-ant-...XXXX` (last 4 chars, from the API), never the full key;
  - collapsible step-by-step "How to get your key" guide:
    1. Go to console.anthropic.com and sign up or log in.
    2. Add billing: Settings > Billing, add a payment method and buy a small amount of credit (pay-as-you-go; a full analysis costs a few cents).
    3. Open Settings > API Keys and click Create Key; name it "ScanPro".
    4. Copy the key immediately (starts with `sk-ant-`); it is shown only once.
    5. Paste it here, click Save, then Test connection.
    6. Optional: set a monthly spend limit in the Anthropic console; revoke the key there at any time.
  - privacy note: encrypted at rest, used only to call Anthropic on the user's behalf, never shown again, removable any time;
  - "Get key" link to https://console.anthropic.com/settings/keys (new tab, `rel="noopener noreferrer"`).
- **Server handling:** `PUT /settings/api-key` checks format (`sk-ant-` prefix, length) and makes a cheap live call (e.g. list models) before storing. Store envelope-encrypted with a KMS CMK in DynamoDB (`USER#<sub>` / `SECRET#anthropic`) with `lastFour` and `validatedAt` as plaintext metadata. Only the generation and settings Lambdas get `kms:Decrypt`; decrypt per request, never cache beyond it, never log. `GET /settings/api-key` returns `{ configured, lastFour, validatedAt }` only.
- **Error mapping:** Anthropic 401 -> "Your API key is invalid or revoked" (link to Settings); credit/billing errors -> "Add credit in the Anthropic console"; 429 -> backoff retry then a friendly message.
- **Never** hardcode, embed, or fall back to an owner key. No key in the frontend bundle, `localStorage`, URL, or logs.

## Privacy / security

- Resumes hold personal data (phone, address, employment) for many users. Store text per-user in DynamoDB and original files in a private, encrypted S3 bucket (block public access, presigned URLs only, short expiry); never bundle in the frontend or commit. The owner uses the app like any other user; no seed script with real data. Account deletion removes DB records and S3 objects; offer data export; add a short privacy/terms page.
- `.gitignore`: `.env*`, `cdk.out`, `node_modules`, `dist`, `*.local.*`, `samples/`.
- All API routes require a Cognito JWT. CORS locked to the CloudFront domain. CloudFront adds security headers (CSP, HSTS, X-Content-Type-Options, frame-ancestors none).
- No secrets in the repo. User API keys live only KMS-encrypted in DynamoDB.
- Public sign-up: Cognito password policy, required email verification, throttled auth endpoints, per-user generation rate limit (e.g. 30 runs/day, configurable).

## Working style for Claude in this repo

- Work phase by phase from `PLAN.md`; confirm scope with the user before starting a new phase and tick off tasks in the plan as they complete.
- Run `typecheck`, `lint`, and tests before saying a task is done. For infra changes run `cdk synth` and the CDK assertion tests, then show `cdk diff` before any deploy.
- Prefer small, reviewable commits. Do not commit or push unless asked.
- Ask before: deploying, deleting stateful resources, changing the region, adding paid services (Route 53 zone, WAF, etc.).
- Keep the prototype file untouched; it is the behavioural spec for prompts and features only, not for visual design.
