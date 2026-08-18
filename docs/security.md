# Security

🌐 Language: **English** | [Español](es/security.md)

This document summarizes the trust boundaries, IAM permissions, and
logging-related security decisions in this sample, and separates what is
implemented here from what a production deployment should add.

## Trust boundaries

```text
Internet (unauthenticated) ──HTTPS──> API Gateway ──IAM role──> Lambda ──IAM role──> CloudWatch Logs / Metrics
                                                                                    └─IAM role──> (SNS: alarms only, not app code)
```

- The API is **public and unauthenticated** by design -- this is a demo
  meant to be curled from a terminal without setting up credentials. See
  [Security Controls Recommended for Production](#security-controls-recommended-for-production)
  for what changes here.
- Traffic between a client and API Gateway is TLS-encrypted
  (`https://...execute-api...`). API Gateway REST APIs do not offer a
  plaintext HTTP option.
- The Lambda function's execution role is scoped to what it actually
  needs: writing to its own CloudWatch Logs log group. It has no
  permissions to any other AWS resource in this account.

## IAM least privilege

| Role | Granted permissions | Why |
| --- | --- | --- |
| Lambda execution role | `AWSLambdaBasicExecutionRole` managed policy (CloudWatch Logs write) | Required to ship logs (and therefore EMF-derived custom metrics) to CloudWatch |
| API Gateway CloudWatch role | `AmazonAPIGatewayPushToCloudWatchLogs` managed policy | Required once per account/region for API Gateway to write execution/access logs |
| SNS topic policy | Default (CloudWatch alarms allowed to publish) | Lets the four alarms in this stack notify the topic |

No IAM permission is granted for `cloudwatch:PutMetricData`, because
custom metrics use Embedded Metric Format (EMF) instead of the
`PutMetricData` API -- see `docs/architecture.md` for why. If you extend
this project to call `PutMetricData` directly, you must add that
permission explicitly; it is not implied by anything already granted
here.

The Lambda execution role's CloudWatch Logs permissions come from the AWS
managed policy `AWSLambdaBasicExecutionRole`, which is scoped to
`arn:aws:logs:*:*:*` (all log groups in the account/region), not just this
function's own log group. This is standard CDK/Lambda default behavior.
For a production workload, consider replacing it with an inline policy
scoped to the specific log group ARN.

## Sensitive data in logs

Structured logging does **not** mean "log everything." This project's
logger (`src/shared/logger.ts`) only ever receives fields the handler
explicitly passes to it: `requestId`, `route`, `method`, `statusCode`,
`durationMs`, `coldStart`, `functionName`, and a small number of
request-specific fields (e.g. `requestedDelayMs`).

The handler deliberately does **not** log:

- Authorization headers or any other request headers
- The full API Gateway event object
- Raw request bodies or arbitrary user-provided payloads
- Cookies, tokens, or credentials of any kind

If you extend the handler to accept request bodies or additional headers,
resist the urge to log the whole `event` object for convenience --
extract only the specific fields you need, the same way the existing
handler does.

## Log injection

Because every log line is `JSON.stringify`'d before being written, values
that contain characters like newlines or quotes are safely escaped inside
the JSON string rather than being able to forge additional fake log
lines or fields. Avoid switching to manual string concatenation for log
messages, which would reintroduce that risk.

## CloudWatch and SNS access

Nothing in this stack changes who can *read* CloudWatch Logs, metrics, or
dashboards, or who can subscribe to the SNS topic -- that is governed by
the IAM permissions of whoever is operating in the AWS account, which this
sample does not attempt to restrict beyond the account's existing IAM
setup. The SNS topic itself has no resource policy beyond the default
(CloudWatch alarms in this account may publish to it); it does not accept
publishes from arbitrary AWS accounts.

Alarm notifications sent to SNS include the alarm name, the metric and
threshold that were breached, and the new/old alarm state -- not any
application data, since the alarms only ever evaluate metric values.

## Removal policy and data retention

Log groups in this stack use `RemovalPolicy.DESTROY` and a 7-day
retention period, so that `cdk destroy` fully cleans up a lab environment
without leaving orphaned log groups behind. This is a **lab-friendly**
choice, not a production one: production systems should choose retention
based on incident investigation windows, compliance requirements, and
cost -- see `docs/cost-considerations.md` -- and should think carefully
before defaulting to `DESTROY` on anything that might contain evidence
needed after a stack is torn down.

## Security Controls Implemented in This Sample

- TLS-only access to the API (enforced by API Gateway)
- Least-privilege Lambda execution role (CloudWatch Logs only, no other
  AWS resource access)
- No secrets, credentials, or full request/response payloads in logs
- Bounded, server-side-clamped failure/latency simulation (callers cannot
  force an arbitrarily long-running invocation)
- Explicit, finite log retention (not "forever" by accident)
- SNS email subscriptions require confirmation (see README) -- no
  notification is delivered to an unconfirmed address
- No hardcoded credentials, account IDs, or personal email addresses
  anywhere in the codebase

## Security Controls Recommended for Production

- **Authentication** -- an IAM authorizer, a Lambda authorizer, or a
  Cognito authorizer in front of the API. This sample has none, on
  purpose, to stay easy to curl during a lab.
- **Rate limiting / usage plans** -- API Gateway usage plans and throttling
  to protect the backend from excessive traffic.
- **AWS WAF** -- for public-facing production APIs, a WAF web ACL in front
  of API Gateway to filter common attack patterns.
- **Scoped-down log-write IAM policy** -- restrict the execution role's
  CloudWatch Logs permissions to this function's specific log group ARN
  instead of the broad managed policy.
- **Encryption at rest for logs** -- CloudWatch Logs supports KMS
  encryption for log groups; this sample uses the CloudWatch-managed
  default, which is unencrypted with a customer key (data is still
  encrypted at rest by AWS, just not with a key you control).
- **Redaction / PII scrubbing** -- if request payloads ever need to be
  logged, redact or hash sensitive fields before they reach
  `console.log`.
- **Longer or regulated retention** -- driven by compliance requirements
  (e.g. audit log retention mandates) rather than the 7-day lab default
  here.
- **Auditability** -- CloudTrail for API-level AWS account activity,
  separate from the application-level CloudWatch Logs this project
  focuses on.
