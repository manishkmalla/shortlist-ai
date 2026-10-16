# Shortlist AI

AI job-application assistant: match score, gap analysis, tailored ATS resume and cover letter. React, Tailwind, AWS CDK. Bring your own Anthropic key.

Paste a job description, pick one of your uploaded resumes, and get a match score, gaps, a cover letter and an ATS-friendly tailored resume. Each user signs up, adds their own Anthropic API key during onboarding, and pays Anthropic directly for usage.

## Status

Early development. Phase 0 (scaffold and wireframes) is done, pending wireframe sign-off. Documentation is in [docs/index.md](docs/index.md). See [PLAN.md](PLAN.md) for the roadmap and [CLAUDE.md](CLAUDE.md) for architecture and conventions. Wireframes: open `docs/wireframes/index.html` in a browser.

## Stack

React 18, Vite, Tailwind CSS, TypeScript, AWS (CloudFront, S3, Cognito, API Gateway, Lambda, DynamoDB, KMS), AWS CDK, Anthropic API.

## Getting started

Requires Node 22+.

```
npm install
npm run dev        # web app
npm test
npm run lint && npm run typecheck
npm run synth      # CDK synth, no AWS credentials needed
```

Deployment to AWS is manual for now (see PLAN.md).
