# Onboarding wizard

Phase 1b. Right after sign-up and email verification, a new user is taken through a short wizard. The one required step is linking a verified Anthropic API key, because the app has no shared key. Until onboarding is finished, every app route redirects to the wizard.

## The flow

| Step | Route state | What happens |
|---|---|---|
| Welcome | `welcome` | What the app does, and that it runs on the user's own Anthropic key (pay-as-you-go, billed by Anthropic, no subscription). Button: Get started |
| API key | `api-key` | The key guide is open, with the same `ApiKeyForm` used in Settings. Continue stays disabled until a verified key is saved. Back returns to Welcome |
| Resume | `resume` | A placeholder until the resume library arrives in Phase 2. Back returns to the key step. Finish setup completes onboarding |
| Done | `done` | Reached by Finish setup. The user lands on New Analysis with a confirmation toast |

The wizard is at `/onboarding`. Users can sign out at any point and pick up at the same step next time.

## Progress and rules (server side)

Progress is stored on the profile as `onboardingStep` and `onboardingCompletedAt`, through `PUT /me` with `{ "onboardingStep": "..." }`. The server, not the browser, enforces the rules:

- Moving to `resume` or `done` needs a verified Anthropic key. Otherwise `409` with code `api_key_required` ("Add and verify your Anthropic API key first.").
- Reaching `done` sets `onboardingCompletedAt` on the server. Clients cannot send a completion time (unknown fields are rejected).
- A finished user cannot re-enter onboarding: `409` with code `already_onboarded`. They can still edit their name and model.
- A key counts as verified when it has a `validatedAt`. A key Anthropic rejected on its last check does not count.

## Route guards

- `RequireAuth`: signed-out visitors go to `/login`.
- `RequireOnboarded` (wraps every app route): an unfinished profile redirects to `/onboarding`. If the profile cannot be loaded, the user sees a "Could not load your account" message with a retry button, not a redirect.
- The wizard itself sends finished users to `/`.

After onboarding, a key that later becomes invalid does not send the user back to the wizard. They see the Settings banner and generation is switched off (Phase 3).

## Accounts created before onboarding existed

Profiles now carry `onboardingVersion`. Profiles without it are migrated the first time they are read:

- With a verified key, they are marked finished (step `done`, completion time set). They are not forced through the wizard.
- Without one, they go through the wizard like a new user.

The migration runs once. A migrated profile is never auto-completed later, so a user who adds a key mid-wizard still sees every step. `onboardingVersion` is internal and is not returned by the API.

## Infrastructure

No new resources. The `GetMe` function gained `dynamodb:UpdateItem` (for the one-time migration), and `UpdateMe` gained `dynamodb:GetItem` (to read the profile and the key status before changing a step). Both stay scoped to the single table.

## Code layout

- Web: `apps/web/src/features/onboarding/` (`OnboardingPage`, `OnboardingGuard`), routes in `App.tsx`.
- API: rules in `apps/api/src/services/profileService.ts` (`OnboardingError`, `migrateLegacy`), mapped to HTTP in `handlers/profile.ts`.
- Shared: `onboardingStepSchema` and the update request in `packages/shared/src/profile.ts`.

## Tests

- **API:** new profiles start at welcome; welcome and api-key allowed without a key; resume and done refused without one; done stamps the time; skipping from api-key to done with a key; finished users cannot re-enter; clients cannot set the completion time or an unknown step; another user's key does not unlock onboarding; legacy accounts with and without a key; a legacy user is not auto-completed mid-wizard.
- **Web:** redirects for unfinished and finished users, retry when the account fails to load, the full walk-through to New Analysis (the key never appears in the page), Continue disabled without a verified key and for a key that needs attention, server refusals shown in place, resuming at the saved step, Back, and signing out.
- **Not yet covered:** a browser-driven Playwright test (sign up, verify, complete the wizard with a mocked key, and an invalid key blocking completion). It follows in its own PR.
