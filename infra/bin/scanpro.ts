import { App } from 'aws-cdk-lib';
import { BaseStack } from '../lib/base-stack';

const app = new App();
const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION ?? 'ap-southeast-2',
};

new BaseStack(app, 'ScanProBase', { env });
