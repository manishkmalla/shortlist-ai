import { Stack, Tags, type StackProps } from 'aws-cdk-lib';
import type { Construct } from 'constructs';

/** Placeholder stack so synth works in Phase 0. Real stacks (auth, data, api, web) arrive in later phases. */
export class BaseStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);
    Tags.of(this).add('app', 'scanpro');
  }
}
