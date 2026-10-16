import { CfnOutput, Stack, Tags, type StackProps } from 'aws-cdk-lib';
import { CorsHttpMethod, HttpApi, HttpMethod, HttpStage } from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpUserPoolAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import type { ITable } from 'aws-cdk-lib/aws-dynamodb';
import { Effect, PolicyStatement } from 'aws-cdk-lib/aws-iam';
import type { IUserPool, IUserPoolClient } from 'aws-cdk-lib/aws-cognito';
import type { IKey } from 'aws-cdk-lib/aws-kms';
import type { Construct } from 'constructs';
import { apiFunction } from './lambda';

export interface ApiStackProps extends StackProps {
  envName: string;
  userPool: IUserPool;
  userPoolClient: IUserPoolClient;
  table: ITable;
  apiKeyKey: IKey;
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
        allowMethods: [CorsHttpMethod.GET, CorsHttpMethod.PUT, CorsHttpMethod.DELETE, CorsHttpMethod.POST],
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

    const env = {
      TABLE_NAME: props.table.tableName,
      USER_POOL_ID: props.userPool.userPoolId,
      KEY_ID: props.apiKeyKey.keyArn,
    };
    const route = (fnId: string, handlerFile: string, method: HttpMethod, path: string) => {
      const fn = apiFunction(this, fnId, handlerFile, env);
      this.api.addRoutes({
        path,
        methods: [method],
        integration: new HttpLambdaIntegration(`${fnId}Integration`, fn),
      });
      return fn;
    };
    // Granted on the role, not the key policy: the key lives in another stack and the default key
    // policy already delegates to IAM, so this avoids a circular stack dependency.
    const allowKms = (fn: ReturnType<typeof route>, ...actions: string[]) =>
      fn.addToRolePolicy(new PolicyStatement({ effect: Effect.ALLOW, actions, resources: [props.apiKeyKey.keyArn] }));

    // One function per verb so each gets only the permissions it needs.
    props.table.grant(route('GetMe', 'profile.ts', HttpMethod.GET, '/me'), 'dynamodb:GetItem', 'dynamodb:PutItem');
    props.table.grant(route('UpdateMe', 'profile.ts', HttpMethod.PUT, '/me'), 'dynamodb:UpdateItem');

    const deleteMe = route('DeleteMe', 'profile.ts', HttpMethod.DELETE, '/me');
    props.table.grant(deleteMe, 'dynamodb:Query', 'dynamodb:BatchWriteItem', 'dynamodb:DeleteItem');
    deleteMe.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['cognito-idp:AdminDeleteUser'],
        resources: [props.userPool.userPoolArn],
      }),
    );

    // Anthropic API key (BYOK). Only the test function can decrypt; saving only creates data keys.
    const keyPath = '/settings/api-key';
    props.table.grant(route('GetApiKeyStatus', 'apiKey.ts', HttpMethod.GET, keyPath), 'dynamodb:GetItem');

    const saveKey = route('SaveApiKey', 'apiKey.ts', HttpMethod.PUT, keyPath);
    props.table.grant(saveKey, 'dynamodb:PutItem');
    allowKms(saveKey, 'kms:GenerateDataKey');

    props.table.grant(route('RemoveApiKey', 'apiKey.ts', HttpMethod.DELETE, keyPath), 'dynamodb:DeleteItem');

    const testKey = route('TestApiKey', 'apiKey.ts', HttpMethod.POST, `${keyPath}/test`);
    props.table.grant(testKey, 'dynamodb:GetItem', 'dynamodb:PutItem');
    allowKms(testKey, 'kms:Decrypt');

    new CfnOutput(this, 'ApiUrl', { value: this.api.apiEndpoint });
  }
}
