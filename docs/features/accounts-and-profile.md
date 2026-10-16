# Accounts and profile

Phase 1. Anyone can create an account, verify their email, sign in, rename themselves and delete their account. Each user has a profile record that later phases extend (onboarding progress, API key status, resumes).

## User flows

| Flow | Route | Notes |
|---|---|---|
| Sign up | `/signup` | Full name, email, password. Cognito emails a 6-digit code. |
| Verify email | `/verify` | Resend available. Reached after sign-up, or after signing in with an unverified account. |
| Sign in | `/login` | Wrong password and unknown email show the same message. Returns you to the page you asked for. |
| Forgot / reset password | `/forgot-password`, `/reset-password` | Code by email, then new password. |
| Sign out | Account menu | Clears the session and the cached profile. |
| Rename | `/settings` | Updates the name used to sign cover letters. |
| Choose a model | `/settings` | Pick from the allow-list. See [Model selection](#model-selection). |
| Delete account | `/settings` | Type `DELETE` to confirm. Removes the profile and the login, then signs out. |

All app routes require a session (`RequireAuth`). Login and sign-up redirect signed-in users into the app (`PublicOnly`).

Password rules (enforced by Cognito, mirrored client-side in `features/auth/schemas.ts`): at least 12 characters, with a lowercase letter, an uppercase letter and a number.

## How it works

```
Browser (React) --Amplify--> Cognito User Pool
Browser --ID token--> API Gateway (JWT authorizer) --> Lambda --> DynamoDB
Cognito --post-confirmation--> Lambda --> DynamoDB (creates profile)
```

- **Web:** `features/auth` (Amplify wrapper `authClient`, `AuthProvider`, guards, forms) and `features/profile` (TanStack Query hooks, settings UI). `lib/api.ts` is the only place that calls the API: it attaches the ID token and validates every response with Zod.
- **API:** `apps/api`. Handlers are thin; logic is in `services/`, DynamoDB access in `repo/`. The user ID comes only from the JWT `sub` claim.
- **Profile creation:** a Cognito post-confirmation trigger writes the profile. If that fails, sign-up still succeeds and `GET /me` creates the profile on first call.
- **Data:** one DynamoDB table, `pk = USER#<sub>`, `sk = PROFILE`. Every repo call is scoped by `pk`.

## API

All routes need `Authorization: Bearer <ID token>` (not the access token: the profile uses the `email` and `name` claims).

| Method | Path | Body | Result |
|---|---|---|---|
| GET | `/me` | none | 200 profile (created if missing) |
| PUT | `/me` | `{ "name"?: string, "modelId"?: string }`. At least one. Name 1 to 100 chars; `modelId` must be on the allow-list. No other fields | 200 profile, 400 invalid, 404 no profile |
| DELETE | `/me` | none | 204. Deletes all items under the user's partition, then the Cognito user |

Profile shape (`packages/shared/src/profile.ts`): `name`, `email`, `onboardingStep` (`welcome | api-key | resume | done`), `onboardingCompletedAt` (ISO or null), `modelId` (always resolved), `createdAt`.

Errors are `{ "error": { "code", "message" } }`. Missing or invalid tokens get `401` from the authorizer.

## Model selection

Users choose which Claude model runs their analyses. The allow-list is in `packages/shared/src/models.ts` (`MODEL_OPTIONS`), shared by the API (validation) and the web app (the picker):

| Model | ID |
|---|---|
| Claude Opus 5.5 | `claude-opus-5-5` |
| Claude Sonnet 5.5 | `claude-sonnet-5-5` |
| Claude Haiku 5.5 | `claude-haiku-5-5` |

- A user's choice is stored on their profile as `modelId`. Until they choose, the profile shows the **default**, which comes from configuration (`DEFAULT_MODEL_ID` on the API functions, set from the CDK context `defaultModelId`, currently `claude-sonnet-5-5`). Handlers never hold a model ID in code, and a default that is not on the allow-list stops the function at start-up.
- Because the default is resolved when the profile is read, changing the default changes it for everyone who has not chosen, and no data migration is needed.
- To change the default: `npx cdk deploy -c defaultModelId=<id>`. To change the list, edit `MODEL_OPTIONS` (and keep model IDs exact, with no date suffixes).
- The picker only stores the choice. Generation uses it from Phase 3.

## Infrastructure

| Stack | Resources |
|---|---|
| `ShortlistAiData-<env>` | DynamoDB table: on-demand, point-in-time recovery, deletion protection, retained |
| `ShortlistAiAuth-<env>` | Cognito pool (self sign-up, email verification, optional TOTP MFA, retained), SRP app client, post-confirmation Lambda (`PutItem` only) |
| `ShortlistAiApi-<env>` | HTTP API with JWT authorizer, CORS limited to the CloudFront origin, throttling 20 req/s (burst 40), one Lambda per verb with its own IAM |
| `ShortlistAiWeb-<env>` | Private S3 bucket and CloudFront (OAC, security headers, SPA fallback) |

Only the delete function can call `cognito-idp:AdminDeleteUser`, and only on this pool.

## Configuration

`apps/web/.env.local` (git-ignored; copy from `.env.example`). Values come from stack outputs:

| Variable | Source |
|---|---|
| `VITE_AWS_REGION` | Deployment region |
| `VITE_COGNITO_USER_POOL_ID` | `ShortlistAiAuth-<env>.UserPoolId` |
| `VITE_COGNITO_CLIENT_ID` | `ShortlistAiAuth-<env>.UserPoolClientId` |
| `VITE_API_URL` | `ShortlistAiApi-<env>.ApiUrl`, no trailing slash |

These are baked into the bundle at build time, so rebuild after changing them.

## Security notes

- Amplify keeps session tokens in `localStorage` (library default). No API keys or other secrets are stored in the browser.
- The API ignores identity in request bodies; `PUT /me` uses a strict schema that rejects unknown fields.
- Logs contain IDs only: no emails, names or resume or job text.
- Cognito's built-in email is limited to about 50 messages a day. Public sign-up at scale needs SES (paid, not yet added).
- Deleting an account removes DynamoDB items and the Cognito user. S3 objects are added to this flow in Phase 2 when uploads exist.

## Tests

- `apps/api`: repo isolation (user A cannot read, rename or delete user B), handler behaviour, trigger never throws.
- `apps/web`: route guards, every auth form, settings rename and delete flows (Amplify and the API mocked), API client (token, schema validation, error mapping).
- `infra`: CDK assertions for retention, authorizer on every route, CORS, throttling, no wildcard IAM actions, delete-user scoping.

Run everything with `npm test`.
