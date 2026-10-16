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

## Deploying infrastructure

Always review the diff first. Look for replacements of stateful resources (user pool, table, buckets): those must not appear.

```
npm run diff -w infra
npm run deploy -w infra
```

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
