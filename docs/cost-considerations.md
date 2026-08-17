# Cost Considerations

**Observability has a cost.** Every log line, every custom metric, every
alarm, and every dashboard is a billable AWS resource or a contributor to
a billable resource. More telemetry is not automatically better telemetry
-- the goal of this document is to explain what drives cost in this
design, not to promise specific dollar amounts, which change over time
and by region. Check the current AWS pricing pages for exact numbers
before estimating a real budget.

## Cost drivers in this project

### API Gateway

Billed per API request (plus data transfer). Every `curl` against
`/health`, `/hello`, or `/work` is one billed request, regardless of
whether it succeeds or fails.

### Lambda

Billed by number of invocations and by execution duration (rounded up),
scaled by allocated memory. The `/work?delayMs=` demo directly controls
duration: a `delayMs=5000` request costs roughly 10x what a `delayMs=500`
request does, because Lambda duration billing is (approximately) linear
in wall-clock execution time.

### CloudWatch Logs

Two separate cost components:

- **Ingestion** -- billed per GB of log data written. Every structured
  log line and every EMF metric log line counts toward this. Verbose
  logging (e.g. logging entire request/response bodies) increases this
  directly.
- **Storage** -- billed per GB-month of log data retained. This is why
  retention matters: see below.

### Log retention

This project retains Lambda and API Gateway access logs for **7 days**
(`logs.RetentionDays.ONE_WEEK`, configured in
`lib/aws-cdk-observable-serverless-api-stack.ts`). Two failure modes to
avoid:

- **Retention set too short**: logs needed to investigate an incident
  discovered a few weeks later are already gone.
- **Retention set too long (or left unlimited, the CloudWatch default)**:
  storage cost accumulates indefinitely for logs nobody will ever look at
  again, and finding relevant logs in Logs Insights becomes slower as the
  log group grows.

Seven days is a reasonable default for a lab you'll actively run and pull
apart within days, not weeks. A production system should choose retention
based on how long it realistically takes to notice and investigate an
incident, plus any compliance-driven minimums -- see `docs/security.md`.

### Custom metrics (EMF)

This project's custom metrics (`SuccessfulRequests`, `FailedRequests`,
`WorkDuration`) are extracted from log data via Embedded Metric Format,
so they don't carry a separate per-`PutMetricData`-call cost -- but CloudWatch
still charges for the resulting custom metric **storage** the same way it
would for metrics published via `PutMetricData`. At meaningful scale,
custom metrics become a real line item, which is why:

- This project publishes only **three** custom metrics.
- Dimensions are limited to `Environment` and `Operation`, both with a
  small, fixed set of values (three operations: `health`, `hello`,
  `work`). CloudWatch bills (and stores) metrics per unique combination
  of metric name + dimension values -- a *metric time series*. Adding a
  high-cardinality dimension such as `requestId` would mean a new,
  separate billable time series for every single request, most of which
  would never be queried again. See `docs/security.md` and the README's
  metrics section for more on why high-cardinality dimensions are avoided
  entirely in this project.

### Dashboards

CloudWatch charges per dashboard, per month, beyond a small number of
free dashboards included in every account. This project creates exactly
**one** dashboard.

### Alarms

CloudWatch charges per alarm, per month (standard-resolution alarms, which
is what this project uses -- all periods are 1 minute). This project
creates exactly **four** alarms. Every additional alarm you add is an
additional ongoing cost, however small.

### SNS

Notification delivery (e.g. one email per alarm state change) is
typically inexpensive at demo scale, but is not free -- SNS charges per
notification delivered, per protocol. Running the failure/latency demos
repeatedly will generate a corresponding number of alarm state change
notifications if you've subscribed an email address.

## A concrete scenario

Consider roughly **10,000 requests/month** split across the three routes,
each producing:

- 1 API Gateway request
- 1 Lambda invocation
- 2-3 structured JSON log lines (request completion, plus warnings/errors
  on the `/work` failure and clamping paths)
- 1-2 EMF custom metric log lines (`SuccessfulRequests`/`FailedRequests`,
  plus `WorkDuration` for `/work` calls)

That's on the order of 10,000 API Gateway requests, 10,000 Lambda
invocations totaling a small number of GB-seconds of compute (this
handler does almost no CPU work outside the intentional `/work` delay),
and roughly 20,000-30,000 small JSON log lines -- likely well under 1 GB
of log ingestion for the month. At this volume, the dominant costs are
almost certainly the fixed per-dashboard and per-alarm charges, not the
per-request/per-GB usage costs. This changes at higher volume, which is
exactly why the design choices above (bounded custom metrics, low
dimension cardinality, finite retention, a curated rather than sprawling
dashboard) matter more as traffic grows.

## Cost optimization concepts this project demonstrates

- **Log only useful operational context.** The logger never receives full
  request/response payloads or headers -- see `docs/security.md`.
- **Choose retention deliberately.** Seven days, chosen and documented,
  not "whatever CloudWatch defaults to."
- **Keep the custom metric count small and dimensions bounded.** Three
  metrics, two low-cardinality dimensions.
- **Avoid unnecessary dashboards.** One dashboard, organized into three
  rows answering specific operational questions, instead of one widget
  per metric CloudWatch happens to expose.
- **Choose alarm periods thoughtfully.** Four alarms, each mapped to a
  specific runbook -- not an alarm for every metric "just in case."
- **Don't publish duplicate telemetry without purpose.** Application
  metrics (`SuccessfulRequests`/`FailedRequests`) are intentionally
  distinct in meaning from the AWS-managed metrics (API Gateway
  `5XXError`, Lambda `Errors`) they sit alongside on the dashboard, not a
  redundant copy of the same signal.
