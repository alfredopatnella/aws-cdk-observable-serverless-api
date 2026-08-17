import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cwActions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';

/**
 * Educational stack: API Gateway -> Lambda -> CloudWatch (logs, metrics,
 * dashboard, alarms) -> SNS.
 *
 * Every threshold and configuration value chosen here is documented in
 * README.md and docs/architecture.md. Keep this file and those documents
 * in sync -- the whole point of the project is that the documentation
 * accurately describes what CDK actually deploys.
 */

const METRIC_NAMESPACE = 'ObservableServerlessApi';
const OPERATIONS = ['health', 'hello', 'work'] as const;

// One-minute periods and single-datapoint evaluation keep this alarm set
// fast to demonstrate in a lab session. See docs/architecture.md for why
// production systems usually want longer/looser evaluation windows.
const ALARM_PERIOD = cdk.Duration.minutes(1);
const LAMBDA_DURATION_THRESHOLD_MS = 1500;
const API_LATENCY_THRESHOLD_MS = 1500;

export class ObservableServerlessApiStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const environment = this.node.tryGetContext('environment') ?? 'dev';
    const alarmEmail: string | undefined = this.node.tryGetContext('alarmEmail');

    // ---------------------------------------------------------------------
    // SNS: single topic that every alarm in this stack notifies.
    // ---------------------------------------------------------------------
    const alarmTopic = new sns.Topic(this, 'AlarmTopic', {
      topicName: `${this.stackName}-alarms`,
      displayName: 'Observable Serverless API Alarms',
    });

    // Email subscriptions are optional and never hardcoded. Deploy with
    // `-c alarmEmail=you@example.com` to receive notifications; SNS will
    // send a confirmation email that must be clicked before delivery
    // begins. Without the context value, the topic is created with no
    // subscribers and the ARN is still available as a stack output.
    if (alarmEmail) {
      alarmTopic.addSubscription(new subscriptions.EmailSubscription(alarmEmail));
    }

    // ---------------------------------------------------------------------
    // Lambda: one function backs all three demo routes.
    // ---------------------------------------------------------------------
    // Log retention is explicit so logs are not kept indefinitely by
    // accident. Seven days is enough to run and debug a lab session
    // without accumulating cost; production retention should instead be
    // driven by incident-investigation and compliance needs (see
    // docs/security.md).
    const functionLogGroup = new logs.LogGroup(this, 'ApiFunctionLogGroup', {
      logGroupName: `/aws/lambda/${this.stackName}-api`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const apiFunction = new NodejsFunction(this, 'ApiFunction', {
      functionName: `${this.stackName}-api`,
      entry: path.join(__dirname, '..', 'src', 'api', 'handler.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 128,
      timeout: cdk.Duration.seconds(10),
      logGroup: functionLogGroup,
      environment: {
        ENVIRONMENT: environment,
      },
      bundling: {
        minify: true,
        sourceMap: true,
      },
    });

    // ---------------------------------------------------------------------
    // API Gateway (REST API): three explicit routes, all backed by the
    // same Lambda via proxy integration.
    // ---------------------------------------------------------------------
    const apiAccessLogGroup = new logs.LogGroup(this, 'ApiAccessLogGroup', {
      logGroupName: `/aws/apigateway/${this.stackName}-access-logs`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const api = new apigateway.RestApi(this, 'Api', {
      restApiName: `${this.stackName}-api`,
      description: 'Observable serverless API demo (health, hello, work)',
      deployOptions: {
        stageName: 'prod',
        metricsEnabled: true,
        loggingLevel: apigateway.MethodLoggingLevel.INFO,
        accessLogDestination: new apigateway.LogGroupLogDestination(apiAccessLogGroup),
        accessLogFormat: apigateway.AccessLogFormat.jsonWithStandardFields({
          caller: false,
          httpMethod: true,
          ip: true,
          protocol: true,
          requestTime: true,
          resourcePath: true,
          responseLength: true,
          status: true,
          user: false,
        }),
      },
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: ['GET'],
      },
    });

    const integration = new apigateway.LambdaIntegration(apiFunction);

    api.root.addResource('health').addMethod('GET', integration);
    api.root.addResource('hello').addMethod('GET', integration);
    api.root.addResource('work').addMethod('GET', integration);

    // ---------------------------------------------------------------------
    // Custom application metrics (Embedded Metric Format, emitted by the
    // Lambda handler in src/shared/metrics.ts). No extra IAM permission is
    // required: EMF metrics are extracted by CloudWatch from the same log
    // stream the function already has permission to write to.
    // ---------------------------------------------------------------------
    const customMetric = (metricName: string, operation: (typeof OPERATIONS)[number]) =>
      new cloudwatch.Metric({
        namespace: METRIC_NAMESPACE,
        metricName,
        dimensionsMap: { Environment: environment, Operation: operation },
        statistic: metricName === 'WorkDuration' ? 'Average' : 'Sum',
        period: ALARM_PERIOD,
      });

    // ---------------------------------------------------------------------
    // AWS-managed metrics: helper references used by both the dashboard
    // and the alarms below, so the two stay consistent by construction.
    // ---------------------------------------------------------------------
    const lambdaInvocations = apiFunction.metricInvocations({ period: ALARM_PERIOD, statistic: 'Sum' });
    const lambdaErrors = apiFunction.metricErrors({ period: ALARM_PERIOD, statistic: 'Sum' });
    const lambdaDuration = apiFunction.metricDuration({ period: ALARM_PERIOD, statistic: 'Average' });
    const lambdaThrottles = apiFunction.metricThrottles({ period: ALARM_PERIOD, statistic: 'Sum' });

    const apiCount = api.metricCount({ period: ALARM_PERIOD, statistic: 'Sum' });
    const apiLatency = api.metricLatency({ period: ALARM_PERIOD, statistic: 'Average' });
    const apiServerErrors = api.metricServerError({ period: ALARM_PERIOD, statistic: 'Sum' });
    const apiClientErrors = api.metricClientError({ period: ALARM_PERIOD, statistic: 'Sum' });

    // ---------------------------------------------------------------------
    // Alarms. Every alarm here uses a one-minute period, a single
    // evaluation period, and `NOT_BREACHING` for missing data: a minute
    // with zero traffic on a low-volume demo API is not evidence of a
    // problem. See docs/architecture.md for the tradeoffs of this choice.
    // ---------------------------------------------------------------------
    const lambdaErrorAlarm = new cloudwatch.Alarm(this, 'LambdaErrorAlarm', {
      alarmName: `${this.stackName}-lambda-errors`,
      alarmDescription:
        'Lambda function reported at least 1 error in a 1-minute period. Intentionally sensitive for demonstration purposes -- see docs/runbooks/high-error-rate.md.',
      metric: lambdaErrors,
      threshold: 1,
      evaluationPeriods: 1,
      datapointsToAlarm: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    const lambdaDurationAlarm = new cloudwatch.Alarm(this, 'LambdaDurationAlarm', {
      alarmName: `${this.stackName}-lambda-duration`,
      alarmDescription: `Average Lambda duration exceeded ${LAMBDA_DURATION_THRESHOLD_MS}ms over a 1-minute period. See docs/runbooks/high-latency.md.`,
      metric: lambdaDuration,
      threshold: LAMBDA_DURATION_THRESHOLD_MS,
      evaluationPeriods: 1,
      datapointsToAlarm: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    const apiServerErrorAlarm = new cloudwatch.Alarm(this, 'ApiServerErrorAlarm', {
      alarmName: `${this.stackName}-api-5xx`,
      alarmDescription:
        'API Gateway reported at least 1 5XX response in a 1-minute period. See docs/runbooks/high-error-rate.md.',
      metric: apiServerErrors,
      threshold: 1,
      evaluationPeriods: 1,
      datapointsToAlarm: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    const apiLatencyAlarm = new cloudwatch.Alarm(this, 'ApiLatencyAlarm', {
      alarmName: `${this.stackName}-api-latency`,
      alarmDescription: `Average API Gateway latency exceeded ${API_LATENCY_THRESHOLD_MS}ms over a 1-minute period. See docs/runbooks/high-latency.md.`,
      metric: apiLatency,
      threshold: API_LATENCY_THRESHOLD_MS,
      evaluationPeriods: 1,
      datapointsToAlarm: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    for (const alarm of [lambdaErrorAlarm, lambdaDurationAlarm, apiServerErrorAlarm, apiLatencyAlarm]) {
      alarm.addAlarmAction(new cwActions.SnsAction(alarmTopic));
      alarm.addOkAction(new cwActions.SnsAction(alarmTopic));
    }

    // ---------------------------------------------------------------------
    // Dashboard: three rows -- API Health, Lambda Health, Application
    // Metrics -- matching the layout documented in README.md.
    // ---------------------------------------------------------------------
    const dashboard = new cloudwatch.Dashboard(this, 'Dashboard', {
      dashboardName: `${this.stackName}-observability`,
    });

    dashboard.addWidgets(
      new cloudwatch.TextWidget({
        markdown: '# API Health\nTraffic, latency, and server-side errors reported by API Gateway.',
        width: 24,
        height: 1,
      }),
    );
    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'API Requests',
        left: [apiCount],
        width: 8,
        height: 6,
      }),
      new cloudwatch.GraphWidget({
        title: 'API Latency',
        left: [apiLatency],
        width: 8,
        height: 6,
      }),
      new cloudwatch.GraphWidget({
        title: 'API 4XX / 5XX Errors',
        left: [apiClientErrors, apiServerErrors],
        width: 8,
        height: 6,
      }),
    );

    dashboard.addWidgets(
      new cloudwatch.TextWidget({
        markdown: '# Lambda Health\nMetrics AWS publishes automatically for the Lambda function.',
        width: 24,
        height: 1,
      }),
    );
    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'Lambda Invocations',
        left: [lambdaInvocations],
        width: 8,
        height: 6,
      }),
      new cloudwatch.GraphWidget({
        title: 'Lambda Errors',
        left: [lambdaErrors],
        width: 8,
        height: 6,
      }),
      new cloudwatch.GraphWidget({
        title: 'Lambda Duration',
        left: [lambdaDuration],
        right: [lambdaThrottles],
        width: 8,
        height: 6,
      }),
    );

    dashboard.addWidgets(
      new cloudwatch.TextWidget({
        markdown:
          '# Application Metrics\nCustom metrics the Lambda handler publishes via Embedded Metric Format (EMF), one series per route.',
        width: 24,
        height: 1,
      }),
    );
    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'Successful Requests',
        left: OPERATIONS.map((op) => customMetric('SuccessfulRequests', op)),
        width: 8,
        height: 6,
      }),
      new cloudwatch.GraphWidget({
        title: 'Failed Requests',
        left: OPERATIONS.map((op) => customMetric('FailedRequests', op)),
        width: 8,
        height: 6,
      }),
      new cloudwatch.GraphWidget({
        title: 'Application Work Duration',
        left: [customMetric('WorkDuration', 'work')],
        width: 8,
        height: 6,
      }),
    );

    dashboard.addWidgets(
      new cloudwatch.AlarmStatusWidget({
        title: 'Alarm Status',
        alarms: [lambdaErrorAlarm, lambdaDurationAlarm, apiServerErrorAlarm, apiLatencyAlarm],
        width: 24,
        height: 4,
      }),
    );

    // ---------------------------------------------------------------------
    // Outputs
    // ---------------------------------------------------------------------
    new cdk.CfnOutput(this, 'ApiUrl', {
      value: api.url,
      description: 'Base URL of the deployed API',
    });

    new cdk.CfnOutput(this, 'DashboardName', {
      value: dashboard.dashboardName,
      description: 'CloudWatch dashboard name',
    });

    new cdk.CfnOutput(this, 'DashboardUrl', {
      value: `https://${this.region}.console.aws.amazon.com/cloudwatch/home?region=${this.region}#dashboards:name=${dashboard.dashboardName}`,
      description: 'Direct link to the CloudWatch dashboard',
    });

    new cdk.CfnOutput(this, 'AlarmTopicArn', {
      value: alarmTopic.topicArn,
      description: 'SNS topic ARN that alarms notify. Subscribe manually or redeploy with -c alarmEmail=you@example.com',
    });

    new cdk.CfnOutput(this, 'LambdaLogGroupName', {
      value: functionLogGroup.logGroupName,
      description: 'CloudWatch Logs group for the API Lambda function',
    });
  }
}
