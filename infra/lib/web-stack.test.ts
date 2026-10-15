import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { it } from 'vitest';
import { WebStack } from './web-stack';

const template = () =>
  Template.fromStack(new WebStack(new App(), 'T', { envName: 'dev' }));

it('site bucket is private and TLS-only', () => {
  const t = template();
  t.hasResourceProperties('AWS::S3::Bucket', {
    PublicAccessBlockConfiguration: {
      BlockPublicAcls: true,
      BlockPublicPolicy: true,
      IgnorePublicAcls: true,
      RestrictPublicBuckets: true,
    },
  });
  t.hasResourceProperties('AWS::S3::BucketPolicy', {
    PolicyDocument: {
      Statement: Match.arrayWith([
        Match.objectLike({ Effect: 'Deny', Condition: { Bool: { 'aws:SecureTransport': 'false' } } }),
      ]),
    },
  });
});

it('CloudFront uses OAC, redirects to HTTPS and sets security headers', () => {
  const t = template();
  t.resourceCountIs('AWS::CloudFront::OriginAccessControl', 1);
  t.hasResourceProperties('AWS::CloudFront::Distribution', {
    DistributionConfig: Match.objectLike({
      DefaultCacheBehavior: Match.objectLike({ ViewerProtocolPolicy: 'redirect-to-https' }),
    }),
  });
  t.hasResourceProperties('AWS::CloudFront::ResponseHeadersPolicy', {
    ResponseHeadersPolicyConfig: Match.objectLike({
      SecurityHeadersConfig: Match.objectLike({
        FrameOptions: { FrameOption: 'DENY', Override: true },
        StrictTransportSecurity: Match.objectLike({ Override: true }),
        ContentSecurityPolicy: Match.objectLike({
          ContentSecurityPolicy: Match.stringLikeRegexp("frame-ancestors 'none'"),
        }),
      }),
    }),
  });
});
