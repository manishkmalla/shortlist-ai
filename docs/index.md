# Shortlist AI documentation

Docs are written alongside each feature and ship in the same PR.

| Doc | What it covers |
|---|---|
| [Accounts and profile](features/accounts-and-profile.md) | Sign-up, sign-in, route guards, the `/me` API, account settings and deletion |
| [Anthropic API key](features/anthropic-api-key.md) | Bring-your-own-key endpoints, encryption, error mapping and IAM scoping |
| [Deployment](deployment.md) | AWS profile, bootstrap, `cdk diff`/`deploy`, publishing the web bundle |

Other references: [PLAN.md](../PLAN.md) (roadmap), [CLAUDE.md](../CLAUDE.md) (architecture and conventions), `docs/wireframes/index.html` (screen wireframes).

## Adding docs for a new feature

1. Create `docs/features/<feature>.md` with: what it does, how it works, config (env vars, stack outputs), API routes, and how it is tested.
2. Add a row to the table above.
3. Never put account IDs, pool IDs, API URLs, keys or user data in docs. Use placeholders like `<ApiUrl>`.
