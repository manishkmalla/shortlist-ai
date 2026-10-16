import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { it } from 'vitest';
import { AuthStack } from './auth-stack';
import { DataStack } from './data-stack';

const template = () => {
  const app = new App();
  const data = new DataStack(app, 'D', { envName: 'dev' });
  return Template.fromStack(new AuthStack(app, 'T', { envName: 'dev', table: data.table }));
};

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

it('post-confirmation trigger can only PutItem and is wired to the pool', () => {
  const t = template();
  t.hasResourceProperties('AWS::Cognito::UserPool', {
    LambdaConfig: { PostConfirmation: Match.anyValue() },
  });
  t.hasResourceProperties('AWS::IAM::Policy', {
    PolicyDocument: {
      Statement: Match.arrayWith([Match.objectLike({ Action: 'dynamodb:PutItem', Effect: 'Allow' })]),
    },
  });
});
