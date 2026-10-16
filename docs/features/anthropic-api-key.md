# Anthropic API key (bring your own key)

Phase 1b. Every user links their own Anthropic API key. The app never ships, shares or pays for a key, and never falls back to an owner key. This page covers the backend. The Settings form and onboarding wizard are documented when they land.

## What the user can do

| Action | Route | Result |
|---|---|---|
| Save or replace a key | `PUT /settings/api-key` `{ "apiKey": "sk-ant-..." }` | Checked for format, verified with a live Anthropic call, then stored encrypted. Returns the status below |
| See status | `GET /settings/api-key` | `{ configured, lastFour, validatedAt }` and nothing else |
| Test the saved key | `POST /settings/api-key/test` | Re-verifies the stored key. Returns the status, or an error |
| Remove | `DELETE /settings/api-key` | 204. The key is gone |

`validatedAt` is `null` when the key has not passed a check. A key that Anthropic rejects during `test` stays saved but loses its `validatedAt`, which is how the UI will know to show a "key needs attention" banner. The full key is never returned by any endpoint, after saving or at any other time.

## Errors

Anthropic failures are mapped to friendly messages. Provider text is never passed through, and the key is never included.

| Situation | HTTP | `error.code` | Message |
|---|---|---|---|
| Bad format, extra fields, not `sk-ant-...` | 400 | `invalid_key_format` | Enter a valid Anthropic API key (it starts with sk-ant-). |
| Anthropic returns 401 or 403 | 400 | `invalid_api_key` | Your API key is invalid or revoked. Check it in Settings. |
| No credit (402, or a 400 billing message) | 402 | `no_credit` | Your Anthropic account has no credit. Add credit in the Anthropic console. |
| Anthropic returns 429 | 429 | `rate_limited` | Anthropic is rate limiting this key. Wait a moment and try again. |
| Anthropic down or unreachable | 502 | `unavailable` | Could not reach Anthropic. Please try again shortly. |

The SDK retries 429 and 5xx twice with backoff before the error is returned.

## How it is stored

```
PUT key --> Lambda --> Anthropic (models.list) --verified--> KMS GenerateDataKey
        --> AES-256-GCM encrypt with the data key --> DynamoDB
```

- **Envelope encryption.** KMS creates a one-off data key. The key is encrypted with AES-256-GCM using it, and only the KMS-encrypted copy of the data key is stored, together with the ciphertext, IV and auth tag. The plaintext data key is zeroed after use.
- **Bound to the user.** The user ID is both the KMS encryption context and the GCM auth data, so a stored secret cannot be opened as another user.
- **Item:** `pk = USER#<sub>`, `sk = SECRET#anthropic`. `lastFour` and `validatedAt` are stored in plaintext as display metadata. Account deletion removes it with the rest of the partition.
- **Per request.** The key is decrypted only inside the `test` function (and, from Phase 3, generation), used once and not cached or logged.

## Infrastructure

| Piece | Details |
|---|---|
| KMS key (`DataStack`) | Customer-managed, annual rotation, retained, alias `alias/shortlist-ai-api-keys-<env>`. A small monthly fee applies |
| `GetApiKeyStatus` | `dynamodb:GetItem` only. No KMS |
| `SaveApiKey` | `dynamodb:PutItem`, `kms:GenerateDataKey`. Cannot decrypt |
| `RemoveApiKey` | `dynamodb:DeleteItem`. No KMS |
| `TestApiKey` | `dynamodb:GetItem`, `PutItem`, `kms:Decrypt`. The only function that can decrypt |

KMS permissions are granted on each function's role rather than the key policy. The key lives in `DataStack` and the default key policy already delegates to IAM, so this avoids a circular stack dependency. Anyone in the account with IAM KMS permissions (such as an admin) can use the key, which is expected for a personal account.

## Code layout

- `packages/shared/src/apiKey.ts`: format check and status schemas, shared with the web app.
- `apps/api/src/llm/`: `LlmProvider` interface, Anthropic implementation and error mapping. Generation methods join the interface in Phase 3.
- `apps/api/src/lib/keyVault.ts`: envelope encryption. `repo/secretRepo.ts`: DynamoDB access. `services/apiKeyService.ts`: the logic. `handlers/apiKey.ts`: thin routing.

## Tests

- **Key never leaks:** it does not appear in any response (save, status, test), in stored items, or in console logs, including on failures.
- **Isolation:** user A cannot see, test or remove user B's key, and a secret sealed for A cannot be opened as B.
- **Encryption:** round trip, fresh data key and IV each time, tampering is detected.
- **Error mapping:** 401, 403, 429, credit (402 and 400 billing text), 5xx and unknown failures, and no provider text in messages.
- **Behaviour:** nothing is stored if live validation fails, `test` clears `validatedAt` only on a rejected key, a transient failure leaves it alone.
- **CDK assertions:** only `TestApiKey` has `kms:Decrypt`, `SaveApiKey` can only generate data keys, read and remove functions have no KMS access, no wildcard IAM actions, the key rotates and is retained.
