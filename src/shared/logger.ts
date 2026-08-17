/**
 * Minimal structured JSON logging helper.
 *
 * Every log line is a single JSON object written to stdout. Lambda ships
 * stdout straight to CloudWatch Logs, so each line becomes one queryable
 * log event. No logging framework is used on purpose -- the goal is to
 * show what structured logging *is*, not to wrap a library.
 */

export type LogLevel = 'INFO' | 'WARN' | 'ERROR';

export interface LogFields {
  requestId?: string;
  route?: string;
  method?: string;
  statusCode?: number;
  durationMs?: number;
  coldStart?: boolean;
  functionName?: string;
  [key: string]: unknown;
}

function write(level: LogLevel, message: string, fields: LogFields = {}): void {
  const entry = {
    level,
    message,
    timestamp: new Date().toISOString(),
    ...fields,
  };

  // console.log/warn/error all forward to the same CloudWatch log stream
  // for a Lambda function; the JSON body is what matters for Logs Insights.
  console.log(JSON.stringify(entry));
}

export const logger = {
  info: (message: string, fields?: LogFields) => write('INFO', message, fields),
  warn: (message: string, fields?: LogFields) => write('WARN', message, fields),
  error: (message: string, fields?: LogFields) => write('ERROR', message, fields),
};
