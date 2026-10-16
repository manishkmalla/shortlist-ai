import { CfnOutput, Duration, RemovalPolicy, Stack, Tags, type StackProps } from 'aws-cdk-lib';
import {
  AccountRecovery,
  Mfa,
  UserPool,
  UserPoolOperation,
  UserPoolClient,
  type IUserPool,
} from 'aws-cdk-lib/aws-cognito';
import type { ITable } from 'aws-cdk-lib/aws-dynamodb';
import type { Construct } from 'constructs';
import { apiFunction } from './lambda';

export interface AuthStackProps extends StackProps {
  envName: string;
  table: ITable;
}

/** Cognito User Pool with self sign-up and mandatory email verification. */
export class AuthStack extends Stack {
  public readonly userPool: IUserPool;
  public readonly userPoolClient: UserPoolClient;

  constructor(scope: Construct, id: string, props: AuthStackProps) {
    super(scope, id, props);
    Tags.of(this).add('app', 'shortlist-ai');
    Tags.of(this).add('env', props.envName);

    const pool = new UserPool(this, 'UserPool', {
      selfSignUpEnabled: true,
      signInAliases: { email: true },
      autoVerify: { email: true },
      standardAttributes: {
        email: { required: true, mutable: false },
        fullname: { required: true, mutable: true },
      },
      passwordPolicy: {
        minLength: 12,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: false,
        tempPasswordValidity: Duration.days(3),
      },
      accountRecovery: AccountRecovery.EMAIL_ONLY,
      mfa: Mfa.OPTIONAL,
      mfaSecondFactor: { otp: true, sms: false },
      removalPolicy: RemovalPolicy.RETAIN,
      deletionProtection: true,
    });
    this.userPool = pool;

    // Creates the profile record once an email is verified. Write-only access to the table.
    const postConfirmation = apiFunction(this, 'PostConfirmation', 'postConfirmation.ts', {
      TABLE_NAME: props.table.tableName,
    });
    props.table.grant(postConfirmation, 'dynamodb:PutItem');
    pool.addTrigger(UserPoolOperation.POST_CONFIRMATION, postConfirmation);

    this.userPoolClient = pool.addClient('WebClient', {
      generateSecret: false,
      authFlows: { userSrp: true },
      preventUserExistenceErrors: true,
      accessTokenValidity: Duration.hours(1),
      idTokenValidity: Duration.hours(1),
      refreshTokenValidity: Duration.days(30),
      enableTokenRevocation: true,
    });

    new CfnOutput(this, 'UserPoolId', { value: pool.userPoolId });
    new CfnOutput(this, 'UserPoolClientId', { value: this.userPoolClient.userPoolClientId });
  }
}
