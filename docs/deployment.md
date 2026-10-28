# Deployment

Deployment is manual, from the owner's machine, to a personal AWS account. Region: `ap-southeast-2`.

## One-time setup

1. Create an IAM user (or Identity Center user) for deployments and enable MFA on it.
2. Configure a dedicated CLI profile. Never use `[default]` or another organisation's profiles:
   ```
   aws configure --profile shortlist-ai-personal
   ```
3. In each shell used for this project:
   ```
   export AWS_PROFILE=shortlist-ai-personal AWS_REGION=ap-southeast-2
   aws sts get-caller-identity     # confirm it is the personal account
   ```
   Environment variables such as `AWS_ACCESS_KEY_ID` override profiles, so unset them first if set.
4. Create a monthly AWS Budget alert (about USD 10).
5. Bootstrap once per account and region:
   ```
   cd infra && npx cdk bootstrap aws://<account-id>/ap-southeast-2
   ```

## One-command deploy

`scripts/deploy.sh` does the steps below in order and stops if anything looks wrong:

```
scripts/deploy.sh                  # sign in, check, diff, confirm, deploy, publish the web app
scripts/deploy.sh --infra-only     # stacks only
scripts/deploy.sh --web-only       # rebuild and publish the web app only
scripts/deploy.sh --skip-checks    # skip typecheck, lint and tests
scripts/deploy.sh --yes            # skip the confirmation prompt (review the diff first)
```

One-time setup: create `scripts/deploy.local.env` (git-ignored) with your account ID, so it is never committed:

```
SHORTLIST_AWS_ACCOUNT_ID=<12-digit account id>
```

It refuses to run if `AWS_ACCESS_KEY_ID` and friends are exported (they would override the profile), or if the signed-in account is not the one in that file. For SSO profiles it runs `aws sso login` when needed. The web build takes the pool ID, client ID and API URL from the deployed stacks, so it does not depend on your local `.env.local`.

## Deploying infrastructure (manual steps)

Always review the diff first. Look for replacements of stateful resources (user pool, table, buckets): those must not appear.

```
npm run diff -w infra
npm run deploy -w infra
```

The default model for users who have not chosen one is the CDK context `defaultModelId` (default `claude-sonnet-5-5`). Override with `npx cdk deploy --all -c defaultModelId=<id>` from `infra/`; the ID must be on the allow-list in `packages/shared/src/models.ts`.

Stack outputs are printed after deploy and can be re-read in CloudFormation. Copy `UserPoolId`, `UserPoolClientId` and `ApiUrl` into `apps/web/.env.local`.

Stateful resources (table, user pool) are retained and protected. Removing them requires manual steps by design.

## Publishing the web app

The infrastructure deploy does not upload the site. After building:

```
npm run build -w apps/web          # needs apps/web/.env.local
aws s3 sync apps/web/dist s3://<SiteBucketName> --delete
aws cloudfront create-invalidation --distribution-id <DistributionId> --paths "/*"
```

`SiteBucketName`, `DistributionId` and `SiteUrl` come from the `ShortlistAiWeb-<env>` outputs. `--delete` removes files not in `dist`, so check the bucket name first. Allow a minute or two for the invalidation.

## Checks after a deploy

- Open `SiteUrl`, sign in and sign out, and refresh on a deep link such as `/settings`.
- `curl -i <ApiUrl>/me` without a token returns `401`.
- Check the browser console for CSP errors.
