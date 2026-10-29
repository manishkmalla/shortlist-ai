import { Duration, RemovalPolicy } from 'aws-cdk-lib';
import { Architecture, Runtime } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import type { Construct } from 'constructs';
import { fileURLToPath } from 'node:url';

const handlersDir = new URL('../../apps/api/src/handlers/', import.meta.url);

/** A bundled API Lambda with the project defaults. IAM is granted by the caller, per function. */
export function apiFunction(
  scope: Construct,
  id: string,
  handlerFile: string,
  environment: Record<string, string>,
  /** Functions that do real work (reading files) need more than the API defaults. */
  options: { memorySize?: number; timeoutSeconds?: number } = {},
) {
  return new NodejsFunction(scope, id, {
    entry: fileURLToPath(new URL(handlerFile, handlersDir)),
    handler: 'handler',
    runtime: Runtime.NODEJS_22_X,
    architecture: Architecture.ARM_64,
    memorySize: options.memorySize ?? 256,
    timeout: Duration.seconds(options.timeoutSeconds ?? 10),
    logGroup: new LogGroup(scope, `${id}Logs`, {
      retention: RetentionDays.ONE_MONTH,
      removalPolicy: RemovalPolicy.DESTROY,
    }),
    environment: { LOG_LEVEL: 'INFO', ...environment },
    bundling: { minify: true, sourceMap: false },
  });
}
