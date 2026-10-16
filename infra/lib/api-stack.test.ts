import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import { ApiStack } from './api-stack';
import { AuthStack } from './auth-stack';
import { DataStack } from './data-stack';

function build() {
  const app = new App();
  const data = new DataStack(app, 'D', { envName: 'dev' });
  const auth = new AuthStack(app, 'A', { envName: 'dev', table: data.table });
  const api = new ApiStack(app, 'T', {
    envName: 'dev',
    userPool: auth.userPool,
    userPoolClient: auth.userPoolClient,
    table: data.table,
    allowedOrigin: 'https://example.cloudfront.net',
  });
  return Template.fromStack(api);
}

const template = build();

describe('ApiStack', () => {
  it('every route requires the JWT authorizer', () => {
    const routes = template.findResources('AWS::ApiGatewayV2::Route');
    expect(Object.keys(routes)).toHaveLength(3);
    for (const r of Object.values(routes)) {
      expect(r.Properties.AuthorizationType).toBe('JWT');
    }
  });

  it('CORS is limited to the site origin', () => {
    template.hasResourceProperties('AWS::ApiGatewayV2::Api', {
      CorsConfiguration: Match.objectLike({ AllowOrigins: ['https://example.cloudfront.net'] }),
    });
  });

  it('the stage is throttled', () => {
    template.hasResourceProperties('AWS::ApiGatewayV2::Stage', {
      DefaultRouteSettings: { ThrottlingRateLimit: 20, ThrottlingBurstLimit: 40 },
    });
  });

  it('no IAM statement uses a wildcard action', () => {
    const policies = template.findResources('AWS::IAM::Policy');
    for (const p of Object.values(policies)) {
      for (const s of p.Properties.PolicyDocument.Statement) {
        const actions: string[] = [].concat(s.Action);
        expect(actions.filter((a) => a.includes('*'))).toEqual([]);
      }
    }
  });

  it('only the delete function may delete users, and only on the pool', () => {
    const policies = template.findResources('AWS::IAM::Policy');
    const withCognito = Object.entries(policies).filter(([, p]) =>
      JSON.stringify(p.Properties.PolicyDocument).includes('cognito-idp:AdminDeleteUser'),
    );
    expect(withCognito).toHaveLength(1);
    expect(withCognito[0]![0]).toMatch(/DeleteMe/);
  });
});
