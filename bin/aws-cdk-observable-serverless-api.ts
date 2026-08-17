#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { ObservableServerlessApiStack } from '../lib/aws-cdk-observable-serverless-api-stack';

const app = new cdk.App();

new ObservableServerlessApiStack(app, 'ObservableServerlessApiStack', {
  /* env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION }, */
  description: 'Educational observability sample: API Gateway + Lambda + CloudWatch + SNS',
});
