/**
 * Custom application metrics using CloudWatch Embedded Metric Format (EMF).
 *
 * EMF is a JSON log structure that CloudWatch parses to extract metrics
 * automatically -- no PutMetricData API call and no extra IAM permission
 * are required beyond the Lambda function's normal permission to write to
 * its own CloudWatch Logs log group. A single EMF log line is both:
 *
 *   1. a structured log event you can query with Logs Insights, and
 *   2. the source of a CloudWatch metric data point.
 *
 * See docs/architecture.md for a longer explanation of why EMF was chosen
 * over calling PutMetricData directly.
 */

export const METRIC_NAMESPACE = 'ObservableServerlessApi';

export type Operation = 'health' | 'hello' | 'work';

export type MetricUnit = 'Count' | 'Milliseconds';

interface MetricDimensions {
  Environment: string;
  Operation: Operation;
}

/**
 * Writes one EMF log line containing a single metric value.
 *
 * Dimensions are intentionally limited to `Environment` and `Operation`.
 * Both have a small, fixed set of possible values. Never add high-cardinality
 * dimensions (requestId, userId, email, etc.) -- each unique dimension value
 * combination becomes its own metric time series, which increases CloudWatch
 * cost and makes dashboards unreadable. See docs/cost-considerations.md.
 */
function publishEmfMetric(
  metricName: string,
  value: number,
  unit: MetricUnit,
  dimensions: MetricDimensions,
): void {
  const emfLogEntry = {
    _aws: {
      Timestamp: Date.now(),
      CloudWatchMetrics: [
        {
          Namespace: METRIC_NAMESPACE,
          Dimensions: [Object.keys(dimensions)],
          Metrics: [{ Name: metricName, Unit: unit }],
        },
      ],
    },
    ...dimensions,
    [metricName]: value,
  };

  console.log(JSON.stringify(emfLogEntry));
}

const environment = process.env.ENVIRONMENT ?? 'dev';

export function recordSuccessfulRequest(operation: Operation): void {
  publishEmfMetric('SuccessfulRequests', 1, 'Count', { Environment: environment, Operation: operation });
}

export function recordFailedRequest(operation: Operation): void {
  publishEmfMetric('FailedRequests', 1, 'Count', { Environment: environment, Operation: operation });
}

export function recordWorkDuration(operation: Operation, durationMs: number): void {
  publishEmfMetric('WorkDuration', durationMs, 'Milliseconds', { Environment: environment, Operation: operation });
}
