# Troubleshooting

Practical, symptom-first workflows for this project. For step-by-step
incident procedures tied to the two alarms, see the runbooks in
`docs/runbooks/`. This document is broader: it covers situations that
aren't necessarily an alarm firing, including problems with the
observability tooling itself.

## API returns 5xx

1. Check the **Lambda Errors** widget on the dashboard (or
   `AWS/Lambda Errors` for the function) -- did invocations fail?
2. Check **API 4XX / 5XX Errors** on the dashboard (`AWS/ApiGateway
   5XXError`) -- confirm the API is actually reporting the failure, not
   just the client.
3. Open the Lambda's CloudWatch Logs log group
   (`/aws/lambda/<stack-name>-api`).
4. Run the ERROR-level Logs Insights query (below) to find the specific
   failing requests.
5. Identify the `requestId` and `route` on the failing entries.
6. If every failure has `"simulateFailure": true`, this is the
   `/work?fail=true` demo working as intended, not a real incident.
7. If failures are unexpected, see
   `docs/runbooks/high-error-rate.md`.

## API is slow

1. Check **API Latency** on the dashboard (`AWS/ApiGateway Latency`, the
   `Average` statistic at a 1-minute period).
2. Compare against `IntegrationLatency` (available in the API Gateway
   console for the stage, or via `api.metricIntegrationLatency()` if you
   add it to the dashboard) -- see the distinction below.
3. Check **Lambda Duration** on the dashboard.
4. Check for **Lambda Throttles** -- concurrency limits can manifest as
   slow or failed requests under load.
5. Query slow-request logs (below) to find specific `durationMs` values
   and the routes/requests responsible.

**Diagnostic relationship:**

- High API latency **and** high Lambda duration → the backend/application
  itself is slow (e.g. someone is hitting `/work?delayMs=`, or real
  application logic has slowed down).
- High API latency **and normal** Lambda duration → look at the API
  Gateway/integration layer or network behavior rather than the function
  itself -- `Latency` includes time outside the Lambda invocation
  (`IntegrationLatency` is the Lambda-invocation portion specifically).

## Lambda alarm is firing

See `docs/runbooks/high-error-rate.md` or `docs/runbooks/high-latency.md`
depending on which alarm (`*-lambda-errors` or `*-lambda-duration`) is in
`ALARM` state. In short: check error/duration values against recent
traffic volume, check the logs for the affected time window, and confirm
whether the cause is the intentional failure/latency demo or something
unexpected.

## API latency alarm is firing

Compare three things for the alarm's time window:

- API Gateway `Latency`
- Lambda `Duration`
- Request volume (`Count` / `Invocations`)

If Lambda duration tracks API latency closely, the slowdown is inside the
function (most likely someone testing `/work?delayMs=`). If API latency
is elevated but Lambda duration is normal, investigate the API Gateway/
integration layer instead of the function code.

## SNS notifications are not arriving

1. Confirm the alarm actually transitioned to `ALARM` (Alarms console) --
   no state change means no notification, by design.
2. Confirm the alarm's **Actions** include the SNS topic
   (`<stack-name>-alarms`) -- this stack wires all four alarms to it by
   default, so a missing action usually means a manual change was made.
3. Check the SNS topic's **Subscriptions** tab. If you deployed without
   `-c alarmEmail=...`, there are no subscriptions and no notifications
   will ever be delivered -- this is expected, not a bug.
4. If a subscription exists, check its status. SNS email subscriptions
   start in `PendingConfirmation` and stay there -- delivering nothing --
   until the recipient clicks the confirmation link in the initial SNS
   email. Check spam/junk folders for that confirmation email.
5. Confirm the subscription protocol/endpoint match what you intended
   (typos in the email address passed to `-c alarmEmail=`).

## Dashboard has no data

1. Confirm you're looking at the CloudWatch console in the **same AWS
   region** the stack was deployed to (`echo $CDK_DEFAULT_REGION`, or
   check the deploy output).
2. Confirm the dashboard's time range actually covers when you generated
   traffic (the default console range may be too narrow or too wide).
3. Confirm you've actually sent traffic -- an idle API produces no new
   data points, which is expected (see missing-data behavior in
   `docs/architecture.md`), not a dashboard bug.
4. Double-check metric **namespace**: AWS-managed widgets use `AWS/Lambda`
   and `AWS/ApiGateway`; custom widgets use `ObservableServerlessApi`
   (or your custom namespace if you changed
   `src/shared/metrics.ts#METRIC_NAMESPACE`).
5. Confirm the **dimensions** on file (`Environment`, `Operation`) match
   what the running Lambda is actually emitting -- e.g. if you changed the
   `ENVIRONMENT` environment variable after deploying the dashboard, old
   widgets pinned to the previous value will go quiet.
6. Confirm you're looking at the dashboard for the stack you actually
   deployed -- the dashboard name is `<stack-name>-observability`; if you
   deployed under a different stack name, the resource names differ too.

## Custom metrics are missing

1. Confirm the namespace matches: `ObservableServerlessApi` (see
   `src/shared/metrics.ts#METRIC_NAMESPACE`).
2. Confirm the Lambda execution role can write logs -- if CloudWatch Logs
   ingestion is broken (e.g. IAM misconfiguration), EMF extraction has
   nothing to parse. Check for `AccessDenied` errors in the Lambda's own
   error output/console.
3. Because this project uses EMF, check the raw Lambda logs for the `_aws`
   metadata block shown in `docs/architecture.md` -- if that block is
   missing or malformed, CloudWatch has nothing to extract a metric from.
   A JSON parsing bug in `src/shared/metrics.ts` would show up here first.
4. Confirm the dimensions used in a query/widget
   (`Environment`/`Operation`) exactly match a value the Lambda is
   actually emitting (case-sensitive).
5. Remember EMF extraction is asynchronous and can lag slightly behind
   the log line being written -- wait a minute or two before assuming a
   metric is truly missing.

## Logs Insights reference

These queries assume the JSON log structure described in the README's
[Structured Logging](../README.md#structured-json-logging) section.

**All ERROR-level events, most recent first:**

```
fields @timestamp, requestId, message, route, statusCode
| filter level = "ERROR"
| sort @timestamp desc
| limit 50
```

**Slow requests (over 1 second):**

```
fields @timestamp, requestId, route, durationMs
| filter durationMs > 1000
| sort durationMs desc
| limit 50
```

**Every log line for one specific request (correlation by request ID):**

```
fields @timestamp, level, message, requestId, route, durationMs
| filter requestId = "REQUEST_ID_HERE"
| sort @timestamp asc
```
