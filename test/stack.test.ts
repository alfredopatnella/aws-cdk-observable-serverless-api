import { App } from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { ObservableServerlessApiStack } from '../lib/aws-cdk-observable-serverless-api-stack';

/**
 * CDK assertion tests: verify that the observability resources described in
 * README.md are actually present in the synthesized CloudFormation, with
 * the configuration the documentation claims.
 */
describe('ObservableServerlessApiStack', () => {
  const app = new App();
  const stack = new ObservableServerlessApiStack(app, 'TestStack');
  const template = Template.fromStack(stack);

  test('creates a REST API with three GET routes', () => {
    template.resourceCountIs('AWS::ApiGateway::RestApi', 1);
    template.resourceCountIs('AWS::ApiGateway::Resource', 3);
    template.hasResourceProperties('AWS::ApiGateway::Resource', { PathPart: 'health' });
    template.hasResourceProperties('AWS::ApiGateway::Resource', { PathPart: 'hello' });
    template.hasResourceProperties('AWS::ApiGateway::Resource', { PathPart: 'work' });
    template.resourcePropertiesCountIs('AWS::ApiGateway::Method', { HttpMethod: 'GET' }, 3);
  });

  test('creates a single Lambda function backing the API', () => {
    template.resourceCountIs('AWS::Lambda::Function', 1);
  });

  test('configures explicit, finite log retention for the Lambda log group', () => {
    template.hasResourceProperties('AWS::Logs::LogGroup', {
      LogGroupName: Match.stringLikeRegexp('^/aws/lambda/'),
      RetentionInDays: 7,
    });
  });

  test('creates an SNS topic for alarm notifications', () => {
    template.resourceCountIs('AWS::SNS::Topic', 1);
    template.hasResourceProperties('AWS::SNS::Topic', {
      DisplayName: 'Observable Serverless API Alarms',
    });
  });

  test('does not create an email subscription when no alarmEmail context is supplied', () => {
    template.resourceCountIs('AWS::SNS::Subscription', 0);
  });

  test('creates a CloudWatch dashboard', () => {
    template.resourceCountIs('AWS::CloudWatch::Dashboard', 1);
  });

  test('creates a Lambda error alarm wired to the SNS topic', () => {
    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      Namespace: 'AWS/Lambda',
      MetricName: 'Errors',
      Statistic: 'Sum',
      Period: 60,
      Threshold: 1,
      EvaluationPeriods: 1,
      DatapointsToAlarm: 1,
      ComparisonOperator: 'GreaterThanOrEqualToThreshold',
      TreatMissingData: 'notBreaching',
      AlarmActions: Match.arrayWith([Match.objectLike({ Ref: Match.stringLikeRegexp('AlarmTopic') })]),
    });
  });

  test('creates a Lambda duration alarm', () => {
    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      Namespace: 'AWS/Lambda',
      MetricName: 'Duration',
      Statistic: 'Average',
      Period: 60,
      Threshold: 1500,
      ComparisonOperator: 'GreaterThanThreshold',
      TreatMissingData: 'notBreaching',
    });
  });

  test('creates an API Gateway 5xx alarm', () => {
    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      Namespace: 'AWS/ApiGateway',
      MetricName: '5XXError',
      Statistic: 'Sum',
      Threshold: 1,
      ComparisonOperator: 'GreaterThanOrEqualToThreshold',
      TreatMissingData: 'notBreaching',
    });
  });

  test('creates an API Gateway latency alarm', () => {
    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      Namespace: 'AWS/ApiGateway',
      MetricName: 'Latency',
      Statistic: 'Average',
      Threshold: 1500,
      ComparisonOperator: 'GreaterThanThreshold',
      TreatMissingData: 'notBreaching',
    });
  });

  test('creates exactly four alarms, all notifying the SNS topic', () => {
    template.resourceCountIs('AWS::CloudWatch::Alarm', 4);
    const alarms = template.findResources('AWS::CloudWatch::Alarm');
    for (const alarm of Object.values(alarms)) {
      expect(alarm.Properties.AlarmActions).toBeDefined();
      expect(alarm.Properties.AlarmActions.length).toBeGreaterThan(0);
    }
  });
});

describe('ObservableServerlessApiStack with alarmEmail context', () => {
  test('creates an SNS email subscription when alarmEmail context is supplied', () => {
    const app = new App({ context: { alarmEmail: 'demo@example.com' } });
    const stack = new ObservableServerlessApiStack(app, 'TestStackWithEmail');
    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::SNS::Subscription', {
      Protocol: 'email',
      Endpoint: 'demo@example.com',
    });
  });
});
