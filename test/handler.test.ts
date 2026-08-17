import type { APIGatewayProxyEvent, Context } from 'aws-lambda';
import { handler, resolveDelayMs } from '../src/api/handler';

function buildEvent(overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent {
  return {
    resource: '/health',
    path: '/health',
    httpMethod: 'GET',
    headers: {},
    multiValueHeaders: {},
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    pathParameters: null,
    stageVariables: null,
    requestContext: { requestId: 'test-request-id' } as APIGatewayProxyEvent['requestContext'],
    body: null,
    isBase64Encoded: false,
    ...overrides,
  } as APIGatewayProxyEvent;
}

const context = { functionName: 'test-function', awsRequestId: 'context-request-id' } as Context;

describe('resolveDelayMs', () => {
  test('defaults to 0 when delayMs is missing', () => {
    expect(resolveDelayMs(undefined, 'req-1', '/work')).toBe(0);
  });

  test('defaults to 0 for non-numeric input', () => {
    expect(resolveDelayMs('not-a-number', 'req-1', '/work')).toBe(0);
  });

  test('defaults to 0 for negative input', () => {
    expect(resolveDelayMs('-100', 'req-1', '/work')).toBe(0);
  });

  test('passes through values within the allowed range', () => {
    expect(resolveDelayMs('250', 'req-1', '/work')).toBe(250);
  });

  test('clamps values above the maximum to 5000', () => {
    expect(resolveDelayMs('999999', 'req-1', '/work')).toBe(5000);
  });
});

describe('handler', () => {
  test('GET /health returns status ok', async () => {
    const result = await handler(buildEvent({ resource: '/health', path: '/health' }), context);
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body)).toEqual({ status: 'ok' });
  });

  test('GET /hello returns a greeting message', async () => {
    const result = await handler(buildEvent({ resource: '/hello', path: '/hello' }), context);
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body)).toEqual({ message: 'Hello from the observable serverless API.' });
  });

  test('GET /work with no query params completes immediately with 0 delay', async () => {
    const result = await handler(buildEvent({ resource: '/work', path: '/work' }), context);
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.appliedDelayMs).toBe(0);
  });

  test('GET /work?delayMs=50 applies the requested delay', async () => {
    const result = await handler(
      buildEvent({ resource: '/work', path: '/work', queryStringParameters: { delayMs: '50' } }),
      context,
    );
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.appliedDelayMs).toBe(50);
  });

  test('GET /work?delayMs=999999 clamps to the maximum bound', async () => {
    const result = await handler(
      buildEvent({ resource: '/work', path: '/work', queryStringParameters: { delayMs: '999999' } }),
      context,
    );
    const body = JSON.parse(result.body);
    expect(body.appliedDelayMs).toBe(5000);
  }, 10000);

  test('GET /work?fail=true throws, producing an observable Lambda failure', async () => {
    await expect(
      handler(buildEvent({ resource: '/work', path: '/work', queryStringParameters: { fail: 'true' } }), context),
    ).rejects.toThrow('Simulated application failure requested via fail=true');
  });
});
