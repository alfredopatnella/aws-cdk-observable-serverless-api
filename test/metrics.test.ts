import { METRIC_NAMESPACE, recordSuccessfulRequest, recordFailedRequest, recordWorkDuration } from '../src/shared/metrics';

/**
 * These tests only verify the shape of the EMF log line the metrics helper
 * writes to stdout (namespace, metric names, bounded dimensions) -- they
 * intentionally do not depend on any CloudWatch API behavior.
 */
describe('metrics (EMF)', () => {
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  function lastLoggedEmf(): any {
    const raw = logSpy.mock.calls[logSpy.mock.calls.length - 1][0];
    return JSON.parse(raw);
  }

  test('recordSuccessfulRequest emits a SuccessfulRequests EMF metric', () => {
    recordSuccessfulRequest('hello');
    const entry = lastLoggedEmf();

    expect(entry._aws.CloudWatchMetrics[0].Namespace).toBe(METRIC_NAMESPACE);
    expect(entry._aws.CloudWatchMetrics[0].Metrics).toEqual([{ Name: 'SuccessfulRequests', Unit: 'Count' }]);
    expect(entry.SuccessfulRequests).toBe(1);
    expect(entry.Operation).toBe('hello');
    expect(entry.Environment).toBeDefined();
  });

  test('recordFailedRequest emits a FailedRequests EMF metric', () => {
    recordFailedRequest('work');
    const entry = lastLoggedEmf();

    expect(entry._aws.CloudWatchMetrics[0].Metrics).toEqual([{ Name: 'FailedRequests', Unit: 'Count' }]);
    expect(entry.FailedRequests).toBe(1);
    expect(entry.Operation).toBe('work');
  });

  test('recordWorkDuration emits a WorkDuration EMF metric in Milliseconds', () => {
    recordWorkDuration('work', 1234);
    const entry = lastLoggedEmf();

    expect(entry._aws.CloudWatchMetrics[0].Metrics).toEqual([{ Name: 'WorkDuration', Unit: 'Milliseconds' }]);
    expect(entry.WorkDuration).toBe(1234);
  });

  test('dimensions are limited to Environment and Operation (bounded cardinality)', () => {
    recordSuccessfulRequest('health');
    const entry = lastLoggedEmf();
    const dimensionSets = entry._aws.CloudWatchMetrics[0].Dimensions;

    expect(dimensionSets).toEqual([['Environment', 'Operation']]);
  });
});
