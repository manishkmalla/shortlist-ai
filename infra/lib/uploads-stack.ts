import { CfnOutput, Duration, RemovalPolicy, Stack, Tags, type StackProps } from 'aws-cdk-lib';
import type { ITable } from 'aws-cdk-lib/aws-dynamodb';
import { Effect, PolicyStatement } from 'aws-cdk-lib/aws-iam';
import {
  BlockPublicAccess,
  Bucket,
  BucketEncryption,
  EventType,
  HttpMethods,
} from 'aws-cdk-lib/aws-s3';
import { LambdaDestination } from 'aws-cdk-lib/aws-s3-notifications';
import type { Construct } from 'constructs';
import { apiFunction } from './lambda';

/** Where the app runs locally (`npm run dev`). Allowed to upload on the dev environment only. */
const LOCAL_DEV_ORIGIN = 'http://localhost:5173';

export interface UploadsStackProps extends StackProps {
  envName: string;
  table: ITable;
  /** The CloudFront origin of the web app, for example https://d123.cloudfront.net. */
  siteOrigin: string;
}

/**
 * Users' uploaded files (Originals) and the function that reads them. The bucket holds personal data, so it is
 * private, encrypted, TLS-only and kept when the stack is deleted. Browsers send files straight to it using
 * short-lived presigned URLs, so its CORS is limited to the web app.
 */
export class UploadsStack extends Stack {
  public readonly bucket: Bucket;

  constructor(scope: Construct, id: string, props: UploadsStackProps) {
    super(scope, id, props);
    Tags.of(this).add('app', 'shortlist-ai');
    Tags.of(this).add('env', props.envName);

    this.bucket = new Bucket(this, 'UploadsBucket', {
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      encryption: BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.RETAIN,
      lifecycleRules: [{ abortIncompleteMultipartUploadAfter: Duration.days(1) }],
      cors: [
        {
          allowedMethods: [HttpMethods.PUT],
          allowedOrigins: [
            props.siteOrigin,
            ...(props.envName === 'dev' ? [LOCAL_DEV_ORIGIN] : []),
          ],
          allowedHeaders: ['content-type'],
          exposedHeaders: ['ETag'],
          maxAge: 3000,
        },
      ],
    });

    // Reads each new file and turns it into the Resume's text.
    const extract = apiFunction(
      this,
      'ExtractUpload',
      'extractUpload.ts',
      { TABLE_NAME: props.table.tableName, BUCKET_NAME: this.bucket.bucketName },
      { memorySize: 1024, timeoutSeconds: 60 },
    );
    extract.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['s3:GetObject', 's3:DeleteObject'],
        resources: [this.bucket.arnForObjects('uploads/*')],
      }),
    );
    props.table.grant(extract, 'dynamodb:GetItem', 'dynamodb:UpdateItem');
    this.bucket.addEventNotification(EventType.OBJECT_CREATED, new LambdaDestination(extract), {
      prefix: 'uploads/',
    });

    new CfnOutput(this, 'UploadsBucketName', { value: this.bucket.bucketName });
  }
}
