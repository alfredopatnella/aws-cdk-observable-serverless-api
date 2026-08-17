import type { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { logger } from '../shared/logger';
import { recordSuccessfulRequest, recordFailedRequest, recordWorkDuration, Operation } from '../shared/metrics';

/**
 * A single Lambda function backs all three demo routes. One function keeps
 * the sample small; routing is done on `event.resource` the same way an
 * `{proxy+}` handler would route on `event.path`.
 */

// Module-scope state persists across invocations on a warm container, so
// this flips to `false` after the first invocation and lets logs show
// whether a request paid the cold-start initialization cost.
let isWarm = false;

// Hard ceiling on the /work?delayMs= simulated delay. Without this, a
// caller could accidentally (or deliberately) hold a Lambda execution open
// for the full 15 minute maximum, which costs money and defeats the point
// of a *bounded* demonstration of latency.
const MAX_DELAY_MS = 5000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function jsonResponse(statusCode: number, body: unknown): APIGatewayProxyResult {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

function resolveOperation(resource: string): Operation {
  if (resource === '/health') return 'health';
  if (resource === '/hello') return 'hello';
  return 'work';
}

/**
 * Parses and clamps the `delayMs` query parameter.
 *
 * - Missing / non-numeric / negative values fall back to 0.
 * - Values above MAX_DELAY_MS are clamped down to MAX_DELAY_MS.
 *
 * Both cases are logged so the difference between "what the caller asked
 * for" and "what actually happened" is visible in the logs.
 */
export function resolveDelayMs(rawValue: string | undefined, requestId: string, route: string): number {
  if (rawValue === undefined) {
    return 0;
  }

  const parsed = Number.parseInt(rawValue, 10);

  if (Number.isNaN(parsed) || parsed < 0) {
    logger.warn('Ignoring invalid delayMs value; defaulting to 0', {
      requestId,
      route,
      requestedDelayMs: rawValue,
    });
    return 0;
  }

  if (parsed > MAX_DELAY_MS) {
    logger.warn('Requested delayMs exceeds maximum; clamping', {
      requestId,
      route,
      requestedDelayMs: parsed,
      appliedDelayMs: MAX_DELAY_MS,
      maxDelayMs: MAX_DELAY_MS,
    });
    return MAX_DELAY_MS;
  }

  return parsed;
}

export async function handler(event: APIGatewayProxyEvent, context: Context): Promise<APIGatewayProxyResult> {
  const startedAt = Date.now();
  const coldStart = !isWarm;
  isWarm = true;

  // The API Gateway request ID ties one client call to every log line and
  // to the API Gateway execution logs, even though this ID is generated
  // before the Lambda invocation begins. It is the simplest correlation
  // identifier available without adding a tracing system.
  const requestId = event.requestContext?.requestId ?? context.awsRequestId;
  const route = event.resource ?? event.path ?? 'unknown';
  const method = event.httpMethod ?? 'UNKNOWN';
  const operation = resolveOperation(route);

  const baseFields = {
    requestId,
    route,
    method,
    coldStart,
    functionName: context.functionName,
  };

  let statusCode = 200;
  let body: unknown;

  try {
    if (route === '/health') {
      body = { status: 'ok' };
    } else if (route === '/hello') {
      body = { message: 'Hello from the observable serverless API.' };
    } else {
      const query = event.queryStringParameters ?? {};
      const shouldFail = query.fail === 'true';
      const requestedDelay = resolveDelayMs(query.delayMs, requestId, route);

      if (shouldFail) {
        // Log before throwing: once the exception propagates, no further
        // application code runs. This is the one log line that explains
        // *why* the failure is happening (as opposed to an unexpected bug).
        logger.error('Simulated application failure', {
          ...baseFields,
          simulateFailure: true,
        });

        // Throwing an unhandled error causes two independently useful
        // signals: (1) Lambda records an Errors metric data point, and
        // (2) API Gateway's Lambda proxy integration converts the failed
        // invocation into an HTTP 502, which counts toward 5XXError.
        throw new Error('Simulated application failure requested via fail=true');
      }

      if (requestedDelay > 0) {
        await sleep(requestedDelay);
      }

      const workDurationMs = Date.now() - startedAt;
      recordWorkDuration(operation, workDurationMs);

      body = {
        message: 'Work completed.',
        requestedDelayMs: query.delayMs !== undefined ? Number.parseInt(query.delayMs, 10) : 0,
        appliedDelayMs: requestedDelay,
      };
    }

    recordSuccessfulRequest(operation);
    const durationMs = Date.now() - startedAt;

    logger.info('Request completed', {
      ...baseFields,
      statusCode,
      durationMs,
    });

    return jsonResponse(statusCode, body);
  } catch (error) {
    statusCode = 500;
    const durationMs = Date.now() - startedAt;

    logger.error('Request failed', {
      ...baseFields,
      statusCode,
      durationMs,
      errorMessage: error instanceof Error ? error.message : 'Unknown error',
    });
    recordFailedRequest(operation);

    // Re-throw so the Lambda invocation is recorded as an error (see the
    // comment above the `throw` for /work?fail=true). Any error reaching
    // this catch block -- simulated or not -- should surface the same way.
    throw error;
  }
}
