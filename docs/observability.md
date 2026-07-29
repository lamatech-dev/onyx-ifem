# Observability

ONYX exposes separate liveness and readiness signals and emits one structured completion record for every HTTP request.

## Health endpoints

`GET /healthz` is a lightweight process-liveness probe. It does not query SQLite or external systems and should be used to decide whether the process needs restarting.

`GET /readyz` verifies that the configured SQLite connection can execute a query and returns a point-in-time messaging snapshot. It reports:

- pending, immediately ready, actively leased, delivered, and dead-lettered outbox messages;
- the oldest pending outbox availability timestamp;
- processing, retryable, completed, and previously failed inbox receipts.

In-memory development mode is ready but explicitly reports `durable: false` and `messaging.enabled: false`. Both probe endpoints are public so infrastructure health checks do not require bearer-token rotation.

## Prometheus metrics

`GET /metrics` returns Prometheus text format 0.0.4 with the required content type and a final newline. It is public to infrastructure and exempt from local rate/concurrency admission so overload remains observable. Do not publish this route through an internet-facing ingress; restrict it to the monitoring network.

Exported series include:

- `onyx_http_requests_total` by normalized method, route template, and status code;
- `onyx_http_request_duration_seconds` as a cumulative histogram;
- `onyx_http_requests_in_flight` and admission rejection counters;
- durable-persistence state, outbox state, oldest pending age, and inbox state;
- process uptime.

Route labels are fixed templates. Raw URLs, command names, organization IDs, aggregate IDs, request IDs, actors, and payload fields never become labels. This bounds cardinality and prevents tenant data from entering the monitoring system.

The Kubernetes Service carries conventional Prometheus scrape annotations. The default NetworkPolicy still requires the Prometheus Pod to have `onyx-ifem.io/client=true` and its namespace to have `onyx-ifem.io/access=true`. Prometheus Operator users can select the Service with a separately managed `ServiceMonitor` instead of relying on annotations.

Provisionable Prometheus recording/alerting rules and a Grafana dashboard are included under `deploy/monitoring`. Their initial thresholds and response procedures are documented in [Production monitoring](monitoring.md). Tune the starter thresholds from measured traffic and service objectives.

## Request correlation

Every response includes `x-request-id`. A caller-provided identifier is preserved only when it contains 1–128 ASCII letters, digits, dots, underscores, colons, or hyphens; otherwise the application generates a UUIDv7. Services should forward this header across synchronous calls and include it in broker metadata when publishing events.

## Structured logs

The Node transport writes newline-delimited JSON completion records. Each record contains:

- timestamp, level, and event name;
- request ID, HTTP method, and URL pathname;
- response status and monotonic duration in milliseconds;
- canonical error code and error class when applicable.

Authorization headers, request/response bodies, and query strings are never logged. Unexpected application errors are written separately with only their class name, avoiding accidental disclosure of tokens or domain payloads.

Admission rejections use the same request completion log shape with canonical `RATE_LIMITED` or `DEPENDENCY_UNAVAILABLE` error codes.

Readiness counters are operational snapshots, not business analytics. Production monitoring should alert on sustained `outbox.deadLettered > 0`, growth in `outbox.pending`, or inbox receipts that remain processing beyond their configured lease.
