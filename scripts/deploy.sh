#!/usr/bin/env bash
# Deploy Shortlist AI to your personal AWS account: sign in, check, diff, deploy, publish the web app.
#
# Usage: scripts/deploy.sh [--infra-only | --web-only] [--skip-checks] [--yes]
#
# One-time setup: create scripts/deploy.local.env (git-ignored) containing
#   SHORTLIST_AWS_ACCOUNT_ID=<your 12-digit personal account id>
# Optional overrides there or in the environment: AWS_PROFILE_NAME, AWS_REGION_NAME, ENV_NAME.
set -euo pipefail

cd "$(dirname "$0")/.."

[ -f scripts/deploy.local.env ] && . scripts/deploy.local.env

PROFILE="${AWS_PROFILE_NAME:-shortlist-ai-personal}"
REGION="${AWS_REGION_NAME:-ap-southeast-2}"
ENV_NAME="${ENV_NAME:-dev}"
EXPECTED_ACCOUNT="${SHORTLIST_AWS_ACCOUNT_ID:-}"

DO_INFRA=1; DO_WEB=1; RUN_CHECKS=1; ASSUME_YES=0
for arg in "$@"; do
  case "$arg" in
    --infra-only) DO_WEB=0 ;;
    --web-only) DO_INFRA=0 ;;
    --skip-checks) RUN_CHECKS=0 ;;
    --yes) ASSUME_YES=1 ;;
    -h|--help) sed -n '2,9p' "$0"; exit 0 ;;
    *) echo "Unknown option: $arg" >&2; exit 2 ;;
  esac
done

say() { printf '\n==> %s\n' "$*"; }
die() { printf 'Error: %s\n' "$*" >&2; exit 1; }
mask() { printf '********%s' "${1: -4}"; }

# --- 1. Make sure we are pointed at the right account -------------------------------------
say "Checking AWS credentials"
[ -n "$EXPECTED_ACCOUNT" ] || die "Set SHORTLIST_AWS_ACCOUNT_ID in scripts/deploy.local.env (see the header of this script)."

# Exported keys override profiles and could point at another account (for example a work one).
for v in AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN; do
  [ -z "${!v:-}" ] || die "$v is set in your shell and would override the profile. Run: unset $v"
done

export AWS_PROFILE="$PROFILE" AWS_REGION="$REGION" AWS_DEFAULT_REGION="$REGION"
command -v aws >/dev/null || die "AWS CLI not found."
aws configure list-profiles | grep -qx "$PROFILE" || die "AWS profile '$PROFILE' not found. Run: aws configure --profile $PROFILE"

# SSO profiles need a browser sign-in; access-key profiles do not.
if aws configure get sso_session --profile "$PROFILE" >/dev/null 2>&1 || aws configure get sso_start_url --profile "$PROFILE" >/dev/null 2>&1; then
  aws sts get-caller-identity >/dev/null 2>&1 || aws sso login --profile "$PROFILE"
fi

ACCOUNT="$(aws sts get-caller-identity --query Account --output text 2>/dev/null)" \
  || die "Could not authenticate with profile '$PROFILE'. Check its access keys, or sign in again."
[ "$ACCOUNT" = "$EXPECTED_ACCOUNT" ] || die "Signed in to account $(mask "$ACCOUNT"), expected $(mask "$EXPECTED_ACCOUNT"). Stopping."
echo "Profile $PROFILE, account $(mask "$ACCOUNT"), region $REGION, env $ENV_NAME"
export CDK_DEFAULT_ACCOUNT="$ACCOUNT" CDK_DEFAULT_REGION="$REGION"

# --- 2. Local checks ---------------------------------------------------------------------
if [ "$RUN_CHECKS" = 1 ]; then
  say "Running typecheck, lint and tests"
  npm run typecheck
  npm run lint
  npm test
fi

# --- 3. Infrastructure -------------------------------------------------------------------
if [ "$DO_INFRA" = 1 ]; then
  say "cdk diff (nothing is changed yet)"
  npm run diff -w infra -- -c "env=$ENV_NAME"
  if [ "$ASSUME_YES" != 1 ]; then
    printf '\nDeploy these changes to account %s? Check the diff above for replaced resources. [y/N] ' "$(mask "$ACCOUNT")"
    read -r reply
    case "$reply" in y|Y|yes|YES) ;; *) echo "Cancelled."; exit 0 ;; esac
  fi
  say "cdk deploy"
  npm run deploy -w infra -- -c "env=$ENV_NAME"
fi

# --- 4. Web app --------------------------------------------------------------------------
if [ "$DO_WEB" = 1 ]; then
  out() { # out <stack> <output key>
    aws cloudformation describe-stacks --stack-name "ShortlistAi$1-$ENV_NAME" \
      --query "Stacks[0].Outputs[?OutputKey=='$2'].OutputValue | [0]" --output text
  }
  say "Reading stack outputs"
  POOL_ID="$(out Auth UserPoolId)"; CLIENT_ID="$(out Auth UserPoolClientId)"; API_URL="$(out Api ApiUrl)"
  BUCKET="$(out Web SiteBucketName)"; DIST_ID="$(out Web DistributionId)"; SITE_URL="$(out Web SiteUrl)"
  for v in POOL_ID CLIENT_ID API_URL BUCKET DIST_ID SITE_URL; do
    [ -n "${!v}" ] && [ "${!v}" != "None" ] || die "Missing stack output for $v. Deploy the infrastructure first."
  done

  say "Building the web app"
  # Values from the deployed stacks take precedence over any local .env file.
  VITE_AWS_REGION="$REGION" VITE_COGNITO_USER_POOL_ID="$POOL_ID" VITE_COGNITO_CLIENT_ID="$CLIENT_ID" \
    VITE_API_URL="${API_URL%/}" npm run build -w apps/web

  say "Uploading to s3://$BUCKET (files not in the build are removed)"
  aws s3 sync apps/web/dist "s3://$BUCKET" --delete

  say "Refreshing CloudFront"
  aws cloudfront create-invalidation --distribution-id "$DIST_ID" --paths '/*' --query 'Invalidation.Status' --output text

  say "Done. Site: $SITE_URL (allow a minute or two for the cache refresh)"
fi
