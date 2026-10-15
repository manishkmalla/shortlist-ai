import { App } from 'aws-cdk-lib';
import { AuthStack } from '../lib/auth-stack';
import { WebStack } from '../lib/web-stack';

const app = new App();
const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION ?? 'ap-southeast-2',
};
const envName = app.node.tryGetContext('env') ?? 'dev';

new AuthStack(app, `ShortlistAiAuth-${envName}`, { env, envName });
new WebStack(app, `ShortlistAiWeb-${envName}`, { env, envName });
