import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { it } from 'vitest';
import { AuthStack } from './auth-stack';

const template = () =>
  Template.fromStack(new AuthStack(new App(), 'T', { envName: 'dev' }));

it('user pool allows self sign-up with email verification and is retained', () => {
  const t = template();
  t.hasResourceProperties('AWS::Cognito::UserPool', {
    AdminCreateUserConfig: { AllowAdminCreateUserOnly: false },
    AutoVerifiedAttributes: ['email'],
    DeletionProtection: 'ACTIVE',
    Policies: { PasswordPolicy: Match.objectLike({ MinimumLength: 12 }) },
  });
  t.hasResource('AWS::Cognito::UserPool', {
    DeletionPolicy: 'Retain',
    UpdateReplacePolicy: 'Retain',
  });
});

it('app client is a public SRP client without a secret', () => {
  template().hasResourceProperties('AWS::Cognito::UserPoolClient', {
    GenerateSecret: false,
    ExplicitAuthFlows: Match.arrayWith(['ALLOW_USER_SRP_AUTH']),
    PreventUserExistenceErrors: 'ENABLED',
  });
});
