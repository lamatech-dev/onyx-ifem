# HTTP application architecture

The API is split into an application dispatcher and a Node HTTP transport.

## Application dispatcher

`OnyxApplication` owns service composition for Mission, Work, Timeline, and Reporting-Evidence. It selects in-memory or SQLite repositories, connects cross-context lookup ports, dispatches command and query routes, and maps domain errors to canonical HTTP response bodies.

Its input and output are plain values:

```ts
const response = await application.handle({
  method: "GET",
  path: "/v1/missions?organization_id=...",
});
```

No socket is required. Each instance owns isolated in-memory state or one configured SQLite connection and exposes an idempotent `close()` method.

## Node transport

The Node HTTP server is limited to transport concerns:

- listening on the configured host and port;
- streaming and parsing JSON command bodies;
- enforcing the 1 MiB request-body limit;
- serializing application responses as JSON;
- graceful signal handling and resource shutdown.
- propagating or generating request IDs and emitting structured completion logs.

`ONYX_PORT` is validated before startup and must be an integer from 1 through 65535.

`GET /healthz` is the process liveness probe. `GET /readyz` verifies persistence and exposes bounded outbox/inbox backlog counters. See [Observability](observability.md).

## Test boundary

Application integration tests invoke the same dispatcher used by the network server. They cover:

- health and not-found behavior;
- readiness, request correlation, and redaction-safe structured logs;
- command route/type matching and validation errors;
- the Mission → Work → Timeline → Reporting-Evidence workflow;
- idempotent replay, organization isolation, listing, and history;
- API-visible SQLite recovery after application recreation.

This keeps CI deterministic and avoids binding network ports while still exercising routing, service composition, contracts, and persistence together.
