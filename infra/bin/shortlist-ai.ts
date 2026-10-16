import { App } from 'aws-cdk-lib';
import { ApiStack } from '../lib/api-stack';
import { AuthStack } from '../lib/auth-stack';
import { DataStack } from '../lib/data-stack';
import { WebStack } from '../lib/web-stack';

const app = new App();
const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION ?? 'ap-southeast-2',
};
const envName = app.node.tryGetContext('env') ?? 'dev';
// Override with: cdk deploy -c defaultModelId=<id>. Must be on the allow-list in packages/shared.
const defaultModelId = app.node.tryGetContext('defaultModelId') ?? 'claude-sonnet-5-5';

const data = new DataStack(app, `ShortlistAiData-${envName}`, { env, envName });
const auth = new AuthStack(app, `ShortlistAiAuth-${envName}`, { env, envName, table: data.table });
const web = new WebStack(app, `ShortlistAiWeb-${envName}`, { env, envName });
new ApiStack(app, `ShortlistAiApi-${envName}`, {
  env,
  envName,
  userPool: auth.userPool,
  userPoolClient: auth.userPoolClient,
  table: data.table,
  apiKeyKey: data.apiKeyKey,
  defaultModelId,
  allowedOrigin: `https://${web.distribution.distributionDomainName}`,
});
