# Runbook: High Latency

🌐 Language: **English** | [Español](../es/runbooks/high-latency.md)

> An alarm tells an operator that something may be wrong. A runbook tells
> the operator what to do next.

## Purpose

Respond to the Lambda duration alarm (`<stack-name>-lambda-duration`) or
the API Gateway latency alarm (`<stack-name>-api-latency`) entering
`ALARM` state.

## Alarm

| | Lambda duration | API latency |
| --- | --- | --- |
| Metric | `AWS/Lambda Duration` | `AWS/ApiGateway Latency` |
| Statistic | Average | Average |
| Period | 1 minute | 1 minute |
| Threshold | `> 1500 ms` | `> 1500 ms` |
| Evaluation periods | 1 | 1 |
| Missing data | `notBreaching` | `notBreaching` |

Both thresholds line up with the `/work?delayMs=` demonstration: normal
`/health` and `/hello` responses complete in well under 100ms, so an
average duration/latency above 1500ms in a given minute almost always
means someone (deliberately or not) requested a large `delayMs` value, or
Lambda cold starts/throttling are adding real overhead. This project uses
the `Average` statistic for simplicity; production systems usually prefer
p90/p95/p99 because averages can hide tail latency that a percentile would
catch. See the README's production considerations section.

## Immediate checks

1. Confirm the alarm's actual state and time window.
2. Check **API Latency** on the dashboard for that window.
3. Check **Lambda Duration** on the dashboard for the same window.
4. Check for **Lambda Throttles** in the same widget -- concurrency limits
   can inflate perceived latency even when individual invocations are
   fast, because requests queue.
5. Check request volume (**API Requests** / **Lambda Invocations**) -- a
   latency spike during a traffic spike reads differently than one during
   quiet periods.

## Investigation

6. Query slow-request logs for the alarm's time window:

   ```
   fields @timestamp, requestId, route, durationMs
   | filter durationMs > 1000
   | sort durationMs desc
   | limit 50
   ```

7. For the slowest entries, check whether `route` is `/work` and whether
   the response indicates a deliberate `delayMs` value was requested
   (the handler logs `requestedDelayMs`/`appliedDelayMs` on the relevant
   log lines). If so, this is the demonstration mechanism, not a real
   incident.
8. If slow requests are not explained by the `delayMs` demo, apply the
   core diagnostic distinction:

   - **High API latency + high Lambda duration** → the backend/application
     itself is slow. Look inside the function: cold starts (check the
     `coldStart` field on log entries), unexpectedly large work, or
     memory/CPU sizing (`memorySize` in the CDK stack).
   - **High API latency + normal Lambda duration** → the slowdown is
     outside the function's own execution time. Check
     `IntegrationLatency` specifically (the portion of `Latency` spent
     invoking the integration) versus the total `Latency`, and consider
     network/API Gateway-side factors.

9. Compare `IntegrationLatency` and `Latency`: `Latency` is the full
   round trip as measured by API Gateway (client request in to client
   response out); `IntegrationLatency` is just the time API Gateway spent
   waiting on the Lambda integration. A large gap between the two points
   away from the Lambda function itself.

## Mitigation

10. For the demo mechanism: stop sending large `delayMs` values.
11. For real cold-start-driven latency: consider provisioned concurrency
    (not configured in this sample, to keep the stack minimal) or confirm
    whether cold starts correlate with a recent deployment (which resets
    warm execution environments).
12. For real application slowness: profile and optimize the handler code
    directly, or increase `memorySize` (which also increases proportional
    CPU allocation for Lambda functions).
13. For throttling: check whether reserved/account concurrency limits are
    being hit and adjust as appropriate.

## Recovery validation

14. Confirm **API Latency** and **Lambda Duration** return to normal
    (well under the 1500ms threshold) for subsequent periods.
15. Confirm the alarm returns to `OK` state and, if subscribed, that a
    recovery notification arrives via SNS.

## Escalation / production considerations

- Percentile-based (p90/p95/p99) latency alarms instead of `Average`, to
  catch tail latency that averages can mask.
- Correlate latency regressions with deployment history as a standard
  first step (was there a deploy right before the alarm fired?).
- Synthetic canaries to detect latency degradation proactively, rather
  than waiting for real user traffic to trip an alarm.

See the README's
[production considerations](../../README.md#what-would-change-for-production)
section for the fuller list.
