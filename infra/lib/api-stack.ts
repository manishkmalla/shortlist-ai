import { CfnOutput, Stack, Tags, type StackProps } from 'aws-cdk-lib';
import { CorsHttpMethod, HttpApi, HttpMethod, HttpStage } from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpUserPoolAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import type { ITable } from 'aws-cdk-lib/aws-dynamodb';
import { Effect, PolicyStatement } from 'aws-cdk-lib/aws-iam';
import type { IUserPool, IUserPoolClient } from 'aws-cdk-lib/aws-cognito';
import type { Construct } from 'constructs';
import { apiFunction } from './lambda';

export interface ApiStackProps extends StackProps {
  envName: string;
  userPool: IUserPool;
  userPoolClient: IUserPoolClient;
  table: ITable;
  /** The CloudFront origin, e.g. https://d123.cloudfront.net. CORS is limited to it. */
  allowedOrigin: string;
}

/** HTTP API behind a Cognito JWT authorizer. Send the ID token: it carries email and name. */
export class ApiStack extends Stack {
  public readonly api: HttpApi;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);
    Tags.of(this).add('app', 'shortlist-ai');
    Tags.of(this).add('env', props.envName);

    this.api = new HttpApi(this, 'Api', {
      createDefaultStage: false,
      corsPreflight: {
        allowOrigins: [props.allowedOrigin],
        allowMethods: [CorsHttpMethod.GET, CorsHttpMethod.PUT, CorsHttpMethod.DELETE],
        allowHeaders: ['authorization', 'content-type'],
      },
      defaultAuthorizer: new HttpUserPoolAuthorizer('JwtAuthorizer', props.userPool, {
        userPoolClients: [props.userPoolClient],
      }),
    });

    new HttpStage(this, 'DefaultStage', {
      httpApi: this.api,
      autoDeploy: true,
      throttle: { rateLimit: 20, burstLimit: 40 },
    });

    const env = { TABLE_NAME: props.table.tableName, USER_POOL_ID: props.userPool.userPoolId };
    const route = (fnId: string, method: HttpMethod) => {
      const fn = apiFunction(this, fnId, 'profile.ts', env);
      this.api.addRoutes({
        path: '/me',
        methods: [method],
        integration: new HttpLambdaIntegration(`${fnId}Integration`, fn),
      });
      return fn;
    };

    // One function per verb so each gets only the permissions it needs.
    props.table.grant(route('GetMe', HttpMethod.GET), 'dynamodb:GetItem', 'dynamodb:PutItem');
    props.table.grant(route('UpdateMe', HttpMethod.PUT), 'dynamodb:UpdateItem');

    const deleteMe = route('DeleteMe', HttpMethod.DELETE);
    props.table.grant(deleteMe, 'dynamodb:Query', 'dynamodb:BatchWriteItem', 'dynamodb:DeleteItem');
    deleteMe.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['cognito-idp:AdminDeleteUser'],
        resources: [props.userPool.userPoolArn],
      }),
    );

    new CfnOutput(this, 'ApiUrl', { value: this.api.apiEndpoint });
  }
}
