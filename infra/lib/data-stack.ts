import { CfnOutput, RemovalPolicy, Stack, Tags, type StackProps } from 'aws-cdk-lib';
import { AttributeType, BillingMode, Table } from 'aws-cdk-lib/aws-dynamodb';
import type { Construct } from 'constructs';

export interface DataStackProps extends StackProps {
  envName: string;
}

/** Single-table store for all user data: items live under pk `USER#<sub>`. */
export class DataStack extends Stack {
  public readonly table: Table;

  constructor(scope: Construct, id: string, props: DataStackProps) {
    super(scope, id, props);
    Tags.of(this).add('app', 'shortlist-ai');
    Tags.of(this).add('env', props.envName);

    this.table = new Table(this, 'Table', {
      partitionKey: { name: 'pk', type: AttributeType.STRING },
      sortKey: { name: 'sk', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      deletionProtection: true,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    new CfnOutput(this, 'TableName', { value: this.table.tableName });
  }
}
