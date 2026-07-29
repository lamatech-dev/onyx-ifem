# Observability

ONYX exposes separate liveness and readiness signals and emits one structured completion record for every HTTP request.

## Health endpoints

`GET /healthz` is a lightweight process-liveness probe. It does not query SQLite or external systems and should be used to decide whether the process needs restarting.

`GET /readyz` verifies that the configured SQLite connection can execute a query and returns a point-in-time messaging snapshot. It reports:

- pending, immediately ready, actively leased, delivered, and dead-lettered outbox messages;
- the oldest pending outbox availability timestamp;
- processing, retryable, completed, and previously failed inbox receipts.

In-memory development mode is ready but explicitly reports `durable: false` and `messaging.enabled: false`. Both probe endpoints are public so infrastructure health checks do not require bearer-token rotation.

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
