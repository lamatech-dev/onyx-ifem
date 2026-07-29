# HTTP resilience and overload protection

ONYX applies bounded admission control before reading a command body. Only `GET /healthz`, `GET /readyz`, and `GET /metrics` are exempt so Kubernetes probes and internal telemetry remain reliable during overload; every other method and route is subject to rate and concurrency limits. Method-aware matching prevents requests such as `POST /metrics` from bypassing admission before body parsing. Keep the exempt readiness and metrics routes restricted to the monitoring network.

## Rate limiting

The local token bucket permits a configurable burst and refills continuously. A rejected request receives HTTP `429`, canonical code `RATE_LIMITED`, `Retry-After`, `X-RateLimit-Remaining`, and its request ID.

Client buckets are bounded by `ONYX_RATE_LIMIT_MAX_CLIENTS`. Once that bound is reached, unknown clients share one overflow bucket rather than allocating unbounded memory. Idle named buckets are removed by a periodic sweep.

By default the client key is the direct socket address. Set `ONYX_TRUST_PROXY=true` only when ONYX is reachable exclusively through a trusted proxy that removes inbound forwarding headers and writes its own `X-Forwarded-For`. Otherwise clients can spoof keys and bypass fair limiting.

The limiter is local to one process. Multi-replica deployments need a central gateway limit for a global policy; the local limiter remains a last line of process protection.

## Concurrency shedding

`ONYX_MAX_IN_FLIGHT` bounds requests admitted into body parsing and application execution. When full, ONYX responds with HTTP `503`, canonical code `DEPENDENCY_UNAVAILABLE`, `Retry-After: 1`, and `Connection: close`. Release handles are idempotent and run in `finally`, including parsing and application failures.

## HTTP parser and socket limits

Defaults are intentionally finite:

| Variable | Default | Purpose |
| --- | ---: | --- |
| `ONYX_REQUEST_TIMEOUT_MS` | 15000 | Receive the complete request |
| `ONYX_HEADERS_TIMEOUT_MS` | 5000 | Receive complete headers |
| `ONYX_SOCKET_TIMEOUT_MS` | 30000 | Bound socket inactivity |
| `ONYX_KEEP_ALIVE_TIMEOUT_MS` | 5000 | Retain an idle keep-alive connection |
| `ONYX_MAX_HEADER_BYTES` | 16384 | Bound total parsed header bytes |
| `ONYX_MAX_HEADERS_COUNT` | 100 | Bound incoming header count |
| `ONYX_MAX_REQUESTS_PER_SOCKET` | 1000 | Rotate long-lived connections |
| `ONYX_MAX_IN_FLIGHT` | 100 | Bound admitted concurrent requests |
| `ONYX_RATE_LIMIT_CAPACITY` | 120 | Per-client burst capacity |
| `ONYX_RATE_LIMIT_REFILL_PER_SECOND` | 20 | Per-client steady refill |
| `ONYX_RATE_LIMIT_MAX_CLIENTS` | 10000 | Bound named bucket memory |
| `ONYX_RATE_LIMIT_IDLE_TTL_MS` | 600000 | Remove inactive named buckets |

`ONYX_HEADERS_TIMEOUT_MS` must not exceed `ONYX_REQUEST_TIMEOUT_MS`. Configuration is validated before the server listens.

The receive timeout protects slow uploads; it is not an application-level transaction cancellation mechanism. If a connection disappears around command completion, clients must replay the same `operation_id` to retrieve the original idempotent event instead of issuing a new operation.

These settings use the behavior documented by the official [Node.js HTTP server API](https://nodejs.org/download/release/latest-v24.x/docs/api/http.html#serverrequesttimeout), including automatic `408` handling for incomplete requests and `maxRequestsPerSocket` connection rotation.
