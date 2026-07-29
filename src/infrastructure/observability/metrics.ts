import type { MessagingSnapshot } from "../sqlite/database.ts";

const DURATION_BUCKETS_SECONDS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10] as const;

export const PROMETHEUS_CONTENT_TYPE = "text/plain; version=0.0.4; charset=utf-8";

export interface MetricsRenderOptions {
  durable: boolean;
  now: Date;
  messaging?: MessagingSnapshot;
}

export interface HttpMeasurement {
  finish(options: {method: string; path: string; status: number; durationSeconds: number}): void;
}

interface HistogramState {
  bucketCounts: number[];
  count: number;
  sum: number;
}

export class PrometheusMetrics {
  readonly #uptimeSeconds: () => number;
  readonly #requests = new Map<string, number>();
  readonly #durations = new Map<string, HistogramState>();
  readonly #admissionRejections = new Map<"concurrency_limited" | "rate_limited", number>();
  #inFlight = 0;

  constructor(uptimeSeconds: () => number = () => process.uptime()) {
    this.#uptimeSeconds = uptimeSeconds;
  }

  startHttpRequest(): HttpMeasurement {
    this.#inFlight += 1;
    let finished = false;
    return {
      finish: ({method, path, status, durationSeconds}) => {
        if (finished) return;
        finished = true;
        this.#inFlight = Math.max(0, this.#inFlight - 1);
        this.#observeHttp(method, path, status, durationSeconds);
      },
    };
  }

  recordAdmissionRejection(reason: "concurrency_limited" | "rate_limited"): void {
    this.#admissionRejections.set(reason, (this.#admissionRejections.get(reason) ?? 0) + 1);
  }

  render(options: MetricsRenderOptions): string {
    const lines = [
      "# HELP onyx_process_uptime_seconds Process uptime in seconds.",
      "# TYPE onyx_process_uptime_seconds gauge",
      `onyx_process_uptime_seconds ${finiteNonNegative(this.#uptimeSeconds())}`,
      "# HELP onyx_persistence_durable Whether durable SQLite persistence is enabled.",
      "# TYPE onyx_persistence_durable gauge",
      `onyx_persistence_durable ${options.durable ? 1 : 0}`,
      "# HELP onyx_http_requests_in_flight HTTP requests currently executing in this process.",
      "# TYPE onyx_http_requests_in_flight gauge",
      `onyx_http_requests_in_flight ${this.#inFlight}`,
      "# HELP onyx_http_requests_total Completed HTTP requests.",
      "# TYPE onyx_http_requests_total counter",
    ];

    for (const [key, count] of sortedEntries(this.#requests)) {
      const values = splitKey(key, 3);
      const method = values[0]!;
      const route = values[1]!;
      const statusCode = values[2]!;
      lines.push(`onyx_http_requests_total${labels({method, route, status_code: statusCode})} ${count}`);
    }

    lines.push(
      "# HELP onyx_http_request_duration_seconds End-to-end HTTP request duration in seconds.",
      "# TYPE onyx_http_request_duration_seconds histogram",
    );
    for (const [key, histogram] of sortedEntries(this.#durations)) {
      const values = splitKey(key, 2);
      const method = values[0]!;
      const route = values[1]!;
      DURATION_BUCKETS_SECONDS.forEach((boundary, index) => {
        lines.push(`onyx_http_request_duration_seconds_bucket${labels({method, route, le: String(boundary)})} ${histogram.bucketCounts[index]}`);
      });
      lines.push(`onyx_http_request_duration_seconds_bucket${labels({method, route, le: "+Inf"})} ${histogram.count}`);
      lines.push(`onyx_http_request_duration_seconds_sum${labels({method, route})} ${histogram.sum}`);
      lines.push(`onyx_http_request_duration_seconds_count${labels({method, route})} ${histogram.count}`);
    }

    lines.push(
      "# HELP onyx_http_admission_rejections_total HTTP requests rejected before application execution.",
      "# TYPE onyx_http_admission_rejections_total counter",
    );
    for (const [reason, count] of sortedEntries(this.#admissionRejections)) {
      lines.push(`onyx_http_admission_rejections_total${labels({reason})} ${count}`);
    }

    if (options.messaging) appendMessaging(lines, options.messaging, options.now);
    return `${lines.join("\n")}\n`;
  }

  #observeHttp(method: string, path: string, status: number, durationSeconds: number): void {
    const normalizedMethod = metricMethod(method);
    const route = metricRoute(path);
    const statusCode = Number.isInteger(status) && status >= 100 && status <= 599 ? String(status) : "unknown";
    const requestKey = joinKey(normalizedMethod, route, statusCode);
    this.#requests.set(requestKey, (this.#requests.get(requestKey) ?? 0) + 1);

    const durationKey = joinKey(normalizedMethod, route);
    const histogram = this.#durations.get(durationKey) ?? {
      bucketCounts: DURATION_BUCKETS_SECONDS.map(() => 0),
      count: 0,
      sum: 0,
    };
    const duration = finiteNonNegative(durationSeconds);
    histogram.count += 1;
    histogram.sum += duration;
    DURATION_BUCKETS_SECONDS.forEach((boundary, index) => {
      if (duration <= boundary) histogram.bucketCounts[index]! += 1;
    });
    this.#durations.set(durationKey, histogram);
  }
}

export function metricRoute(path: string): string {
  let pathname: string;
  try {
    pathname = new URL(path, "http://onyx.local").pathname;
  } catch {
    return "unmatched";
  }
  if (["/healthz", "/readyz", "/metrics", "/openapi.json"].includes(pathname)) return pathname;
  if (/^\/v1\/[^/]+\/commands\/[^/]+$/.test(pathname)) return "/v1/{context}/commands/{command_type}";
  if (/^\/v1\/[^/]+$/.test(pathname)) return "/v1/{resource}";
  if (/^\/v1\/[^/]+\/[^/]+$/.test(pathname)) return "/v1/{resource}/{object_id}";
  if (/^\/v1\/[^/]+\/[^/]+\/history$/.test(pathname)) return "/v1/{resource}/{object_id}/history";
  return "unmatched";
}

function metricMethod(method: string): string {
  const normalized = method.toUpperCase();
  return ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"].includes(normalized) ? normalized : "OTHER";
}

function appendMessaging(lines: string[], snapshot: MessagingSnapshot, now: Date): void {
  lines.push(
    "# HELP onyx_outbox_messages Current transactional outbox messages by state.",
    "# TYPE onyx_outbox_messages gauge",
    `onyx_outbox_messages${labels({state: "pending"})} ${snapshot.outbox.pending}`,
    `onyx_outbox_messages${labels({state: "ready"})} ${snapshot.outbox.ready}`,
    `onyx_outbox_messages${labels({state: "leased"})} ${snapshot.outbox.leased}`,
    `onyx_outbox_messages${labels({state: "delivered"})} ${snapshot.outbox.delivered}`,
    `onyx_outbox_messages${labels({state: "dead_lettered"})} ${snapshot.outbox.deadLettered}`,
    "# HELP onyx_inbox_receipts Current consumer inbox receipts by state.",
    "# TYPE onyx_inbox_receipts gauge",
    `onyx_inbox_receipts${labels({state: "processing"})} ${snapshot.inbox.processing}`,
    `onyx_inbox_receipts${labels({state: "retryable"})} ${snapshot.inbox.retryable}`,
    `onyx_inbox_receipts${labels({state: "completed"})} ${snapshot.inbox.completed}`,
    `onyx_inbox_receipts${labels({state: "failed"})} ${snapshot.inbox.failed}`,
  );
  if (snapshot.outbox.oldestPendingAt) {
    const timestamp = Date.parse(snapshot.outbox.oldestPendingAt);
    if (Number.isFinite(timestamp)) {
      lines.push(
        "# HELP onyx_outbox_oldest_pending_age_seconds Age of the oldest pending outbox message.",
        "# TYPE onyx_outbox_oldest_pending_age_seconds gauge",
        `onyx_outbox_oldest_pending_age_seconds ${Math.max(0, (now.getTime() - timestamp) / 1_000)}`,
      );
    }
  }
}

function finiteNonNegative(value: number): number {
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

function labels(values: Readonly<Record<string, string>>): string {
  return `{${Object.entries(values).map(([name, value]) => `${name}="${escapeLabel(value)}"`).join(",")}}`;
}

function escapeLabel(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("\n", "\\n").replaceAll('"', '\\"');
}

function joinKey(...values: string[]): string {
  return values.join("\u0000");
}

function splitKey(key: string, expected: number): string[] {
  const values = key.split("\u0000");
  if (values.length !== expected) throw new Error("invalid internal metrics key");
  return values;
}

function sortedEntries<T>(map: ReadonlyMap<string, T>): Array<[string, T]> {
  return [...map.entries()].sort(([left], [right]) => left.localeCompare(right));
}
