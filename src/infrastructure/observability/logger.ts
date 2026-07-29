export type LogLevel = "info" | "warn" | "error";

export interface RequestLogRecord {
  timestamp: string;
  level: LogLevel;
  event: "http.request.completed";
  request_id: string;
  method: string;
  path: string;
  status: number;
  duration_ms: number;
  error_code?: string;
  error_name?: string;
}

export type StructuredLogger = (record: RequestLogRecord) => void;

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

export function resolveRequestId(value: string | undefined, fallback: () => string): string {
  return value !== undefined && REQUEST_ID_PATTERN.test(value) ? value : fallback();
}

export function jsonLineLogger(write: (line: string) => void = (line) => process.stdout.write(line)): StructuredLogger {
  return (record) => write(`${JSON.stringify(record)}\n`);
}
