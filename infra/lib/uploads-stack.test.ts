import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import { DataStack } from './data-stack';
import { UploadsStack } from './uploads-stack';

const SITE = 'https://example.cloudfront.net';

function build(envName: string) {
  const app = new App();
  const data = new DataStack(app, 'D', { envName });
  const stack = new UploadsStack(app, 'U', { envName, table: data.table, siteOrigin: SITE });
  return Template.fromStack(stack);
}

const dev = build('dev');
const prod = build('prod');

describe('UploadsStack bucket', () => {
  it('is private, encrypted and TLS-only', () => {
    dev.hasResourceProperties('AWS::S3::Bucket', {
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
      BucketEncryption: {
        ServerSideEncryptionConfiguration: [
          Match.objectLike({ ServerSideEncryptionByDefault: { SSEAlgorithm: 'AES256' } }),
        ],
      },
    });
    dev.hasResourceProperties('AWS::S3::BucketPolicy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Effect: 'Deny',
            Condition: { Bool: { 'aws:SecureTransport': 'false' } },
          }),
        ]),
      },
    });
  });

  it('is kept when the stack is deleted, and files are never auto-deleted', () => {
    dev.hasResource('AWS::S3::Bucket', { DeletionPolicy: 'Retain', UpdateReplacePolicy: 'Retain' });
    expect(Object.keys(dev.findResources('Custom::S3AutoDeleteObjects'))).toHaveLength(0);
  });

  it('has no automatic expiry, but cleans up abandoned multipart uploads after a day', () => {
    const [bucket] = Object.values(dev.findResources('AWS::S3::Bucket'));
    const rules = bucket!.Properties.LifecycleConfiguration.Rules;
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({
      AbortIncompleteMultipartUpload: { DaysAfterInitiation: 1 },
      Status: 'Enabled',
    });
    expect(rules[0]).not.toHaveProperty('ExpirationInDays');
  });
});

describe('UploadsStack CORS', () => {
  const origins = (t: Template) => {
    const [bucket] = Object.values(t.findResources('AWS::S3::Bucket'));
    const rules = bucket!.Properties.CorsConfiguration.CorsRules;
    expect(rules).toHaveLength(1);
    return rules[0];
  };

  it('production allows only the site origin', () => {
    expect(origins(prod).AllowedOrigins).toEqual([SITE]);
  });

  it('development also allows the local dev server', () => {
    expect(origins(dev).AllowedOrigins).toEqual([SITE, 'http://localhost:5173']);
  });

  it('only allows uploading (PUT) with a content type, and never wildcards', () => {
    for (const t of [dev, prod]) {
      const rule = origins(t);
      expect(rule.AllowedMethods).toEqual(['PUT']);
      expect(rule.AllowedHeaders).toEqual(['content-type']);
      expect(rule.AllowedOrigins).not.toContain('*');
    }
  });
});

describe('UploadsStack extraction', () => {
  it('runs when a file is created under the uploads prefix only', () => {
    dev.hasResourceProperties('Custom::S3BucketNotifications', {
      NotificationConfiguration: {
        LambdaFunctionConfigurations: [
          Match.objectLike({
            Events: ['s3:ObjectCreated:*'],
            Filter: { Key: { FilterRules: [{ Name: 'prefix', Value: 'uploads/' }] } },
          }),
        ],
      },
    });
  });

  it('has room to read a file, and does not reserve concurrency', () => {
    const fn = Object.values(dev.findResources('AWS::Lambda::Function')).find((f) =>
      JSON.stringify(f.Properties.Environment ?? {}).includes('BUCKET_NAME'),
    )!;
    expect(fn.Properties).toMatchObject({ MemorySize: 1024, Timeout: 60, Runtime: 'nodejs22.x' });
    expect(fn.Properties).not.toHaveProperty('ReservedConcurrentExecutions');
    expect(JSON.stringify(fn.Properties.Environment)).toContain('TABLE_NAME');
  });

  it('can only read and delete files under the uploads prefix, and read and update Resume items', () => {
    const policies = Object.entries(dev.findResources('AWS::IAM::Policy')).filter(([id]) =>
      /Extract/.test(id),
    );
    expect(policies).toHaveLength(1);
    const statements = policies[0]![1].Properties.PolicyDocument.Statement as {
      Action: string | string[];
      Resource: unknown;
    }[];
    const actions = statements.flatMap((s) => ([] as string[]).concat(s.Action)).sort();
    expect(actions).toEqual([
      'dynamodb:GetItem',
      'dynamodb:UpdateItem',
      's3:DeleteObject',
      's3:GetObject',
    ]);
    const s3 = statements.find((s) => JSON.stringify(s.Action).includes('s3:'))!;
    expect(JSON.stringify(s3.Resource)).toContain('/uploads/*');
  });

  it('uses no wildcard actions', () => {
    const policies = Object.entries(dev.findResources('AWS::IAM::Policy')).filter(([id]) =>
      /Extract/.test(id),
    );
    for (const [, p] of policies) {
      for (const s of p.Properties.PolicyDocument.Statement) {
        expect(([] as string[]).concat(s.Action).filter((a) => a.includes('*'))).toEqual([]);
      }
    }
  });
});
