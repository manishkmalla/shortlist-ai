import { App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { it } from 'vitest';
import { DataStack } from './data-stack';

it('table is retained, protected and has point-in-time recovery', () => {
  const t = Template.fromStack(new DataStack(new App(), 'T', { envName: 'dev' }));
  t.hasResourceProperties('AWS::DynamoDB::Table', {
    KeySchema: [
      { AttributeName: 'pk', KeyType: 'HASH' },
      { AttributeName: 'sk', KeyType: 'RANGE' },
    ],
    BillingMode: 'PAY_PER_REQUEST',
    DeletionProtectionEnabled: true,
    PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true },
  });
  t.hasResource('AWS::DynamoDB::Table', { DeletionPolicy: 'Retain', UpdateReplacePolicy: 'Retain' });
});

it('API key CMK rotates and is retained', () => {
  const t = Template.fromStack(new DataStack(new App(), 'T', { envName: 'dev' }));
  t.hasResourceProperties('AWS::KMS::Key', { EnableKeyRotation: true });
  t.hasResource('AWS::KMS::Key', { DeletionPolicy: 'Retain', UpdateReplacePolicy: 'Retain' });
  t.hasResourceProperties('AWS::KMS::Alias', { AliasName: 'alias/shortlist-ai-api-keys-dev' });
});
