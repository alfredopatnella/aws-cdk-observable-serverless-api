# Runbook: High Error Rate

🌐 Language: **English** | [Español](../es/runbooks/high-error-rate.md)

> An alarm tells an operator that something may be wrong. A runbook tells
> the operator what to do next.

## Purpose

Respond to the Lambda error alarm (`<stack-name>-lambda-errors`) or the
API Gateway 5xx alarm (`<stack-name>-api-5xx`) entering `ALARM` state.

## Alarm

| | Lambda errors | API 5xx |
| --- | --- | --- |
| Metric | `AWS/Lambda Errors` | `AWS/ApiGateway 5XXError` |
| Statistic | Sum | Sum |
| Period | 1 minute | 1 minute |
| Threshold | `>= 1` | `>= 1` |
| Evaluation periods | 1 | 1 |
| Missing data | `notBreaching` | `notBreaching` |

Both alarms are **intentionally sensitive** -- a single error in a single
minute is enough to trip them. That's appropriate for demonstrating the
alarm-to-SNS pipeline on demand, not for a production error budget. A
production version of this alarm should account for normal traffic
levels, expected transient failure rates, and business criticality (see
the README's production considerations) rather than alarming on any
single error.

## Immediate checks

1. Confirm the alarm's actual state and the time window it fired for
   (CloudWatch Alarms console, or `aws cloudwatch describe-alarms
   --alarm-names <stack-name>-lambda-errors`).
2. Look at **Lambda Invocations** next to **Lambda Errors** on the
   dashboard for the same window -- one error out of one invocation reads
   very differently from one error out of a thousand.
3. Look at **API 4XX / 5XX Errors** on the dashboard -- confirm whether
   API Gateway is also reporting the failure (it should be, for any error
   that escapes the Lambda handler unhandled).

## Investigation

4. Open the Lambda's CloudWatch Logs log group
   (`/aws/lambda/<stack-name>-api`, linked from the Lambda console or the
   `LambdaLogGroupName` stack output).
5. Run this Logs Insights query for the alarm's time window:

   ```
   fields @timestamp, requestId, message, route, statusCode
   | filter level = "ERROR"
   | sort @timestamp desc
   | limit 50
   ```

6. For each distinct `requestId` that shows up, pull every log line for
   that request to see the full story:

   ```
   fields @timestamp, level, message, requestId, route, durationMs
   | filter requestId = "REQUEST_ID_HERE"
   | sort @timestamp asc
   ```

7. Identify which **route** is affected. If every failing request has
   `"route": "/work"` and `"simulateFailure": true` in its log entry,
   this is the `fail=true` demonstration mechanism working exactly as
   designed -- not a real incident. Confirm with whoever is running the
   demo before treating it as one.
8. If the failures are not the simulated-failure demo, determine which
   category the failure falls into:
   - **Application code** -- a bug in the handler logic itself.
   - **Configuration** -- e.g. a missing environment variable, wrong
     permission.
   - **Dependency** -- this sample has no external dependencies (no
     database, no downstream API), so a dependency-related cause here
     would point at something added since this project's original scope.
   - **Capacity** -- check for `Throttles` on the Lambda dashboard widget;
     throttling shows up as errors from the caller's perspective too.

## Mitigation

9. For the demo mechanism: simply stop sending `fail=true` requests. The
   error rate will return to zero on its own.
10. For a real application bug: roll back the most recent deployment if
    the timing correlates, or patch and redeploy
    (`npm run build && npx cdk deploy`).
11. For a configuration issue: fix the CDK stack configuration
    (environment variables, IAM permissions) and redeploy.

## Recovery validation

12. Confirm the **Lambda Errors** and **API 5XX Errors** widgets return to
    zero for subsequent 1-minute periods.
13. Confirm the alarm returns to `OK` state. Because both alarms have an
    OK action wired to the same SNS topic, you should also receive a
    "recovered" notification if you've subscribed an email address.

## Escalation / production considerations

This sample has no on-call rotation, escalation policy, or incident
management tooling -- it's a lab. A production deployment of a pattern
like this would typically add:

- Error-rate (percentage) alarms instead of absolute counts, reflecting
  an actual error budget/SLO.
- Escalation policies and paging (e.g. PagerDuty) rather than a bare SNS
  email subscription.
- A distinction between "known, expected transient errors" and "novel
  failures," often via composite alarms or anomaly detection.
- Correlation with recent deployments (a deployment-health/rollback
  workflow) as a first-class investigation step.

See the README's
[production considerations](../../README.md#what-would-change-for-production)
section for the fuller list.
