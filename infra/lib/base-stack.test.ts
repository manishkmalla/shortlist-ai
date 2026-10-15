import { App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { expect, it } from 'vitest';
import { BaseStack } from './base-stack';

it('synthesises', () => {
  const stack = new BaseStack(new App(), 'T');
  expect(Template.fromStack(stack).toJSON()).toBeTruthy();
});
