# ONYX IFEM

ONYX is an interface-first execution framework. This repository turns the IFEM v2.0 contract baseline into an executable, independently testable system.

The executable baseline includes the Mission, Work, Timeline, and Reporting-Evidence contexts. It implements every v2.0 command whose payload is marked `FIELD_COMPLETE`, enforces authority, optimistic concurrency, idempotency, and organization boundaries, persists state with its events, and exposes read APIs.

## Repository layout

```text
contracts/v2.0/       Versioned machine-readable contract baseline
src/api/              Service composition and port-free request dispatcher
src/auth/             Ed25519 bearer authentication and JWT validation
src/contracts/        Canonical envelope and shared runtime types
src/infrastructure/   SQLite persistence and transactional outbox delivery
src/mission/          Mission domain and application service
src/work/             Work/Task domain and application service
src/timeline/         Timeline domain and application service
src/reporting-evidence/ Report domain and application service
src/shared/           Deterministic serialization and identifier utilities
tests/                Contract and domain verification
tools/                Repository-level validation commands
```

## Requirements

- Node.js 24 or newer

The API has no third-party runtime dependencies. TypeScript and the matching Node.js type definitions are development-only dependencies.

## Verify

```bash
npm ci
npm run check
```

The check pipeline validates the imported contracts, performs a strict no-emit TypeScript compilation, and runs the complete test suite. See [Type safety](docs/type-safety.md).

## Run the API

```bash
npm start
```

The server listens on `127.0.0.1:3000` by default. Configure `ONYX_HOST`, `ONYX_PORT`, and replica identifiers when needed.

Authentication is disabled for local development. Production deployments can require Ed25519-signed bearer tokens with `ONYX_AUTH_MODE=required`; single-PEM and static-JWKS key rotation profiles are documented in [Authentication and authorization](docs/authentication.md).

Every response carries an `x-request-id`; the server emits redaction-safe structured JSON logs. Use `/healthz` for liveness and `/readyz` for persistence plus messaging readiness. See [Observability](docs/observability.md).

Prometheus-compatible, bounded-cardinality operational metrics are available at `GET /metrics`; keep this infrastructure endpoint off public ingress routes. Provisionable alert rules, a Grafana dashboard, and response procedures are in [Production monitoring](docs/monitoring.md).

Finite token-bucket, concurrency, header, receive, socket, and connection-reuse limits protect the HTTP boundary. See [HTTP resilience and overload protection](docs/http-resilience.md).

Set `ONYX_OUTBOX_WEBHOOK_URL` to run the crash-recoverable outbox publisher. Production configuration, HTTPS delivery headers, lease sizing, and graceful shutdown behavior are documented in [Production deployment](docs/deployment.md).

The hardened production container, CI security gates, CycloneDX SBOM, multi-platform GHCR publishing, and tag-based release process are documented in [Container and release supply chain](docs/container-and-release.md).

The hardened singleton StatefulSet, persistent-volume model, probes, secrets, network policy, and immutable-image deployment procedure are documented in [Kubernetes deployment](docs/kubernetes.md).

Online backup, manifest verification, restore rehearsal, and migration compatibility checks are available through the `db:backup`, `db:verify`, and `db:restore` scripts. See [Backup and disaster recovery](docs/disaster-recovery.md).

The application dispatcher is independent of the Node HTTP transport, so route workflows can run without opening sockets. See [HTTP application architecture](docs/http-architecture.md).

A self-contained OpenAPI 3.1.2 document is available at `GET /openapi.json` or through `npm run openapi`. See [OpenAPI description](docs/openapi.md).

State is in-memory unless `ONYX_DB_PATH` is set. Enable durable SQLite persistence with:

```bash
ONYX_DB_PATH=./data/onyx.db npm start
```

Mission, Work, Timeline, and Reporting-Evidence keep separate context ownership while sharing the same transactional database. See [Persistence](docs/persistence.md).

Every durable event is written to a transactional outbox in the same commit as its aggregate state. The bounded dispatcher supports exclusive leases, retry backoff, dead-lettering, and at-least-once delivery with stable event identifiers. A persistent consumer inbox adds per-consumer deduplication, tamper detection, and crash-recoverable processing leases.

Available endpoints:

- `GET /healthz`
- `GET /readyz`
- `GET /metrics`
- `GET /openapi.json`
- `POST /v1/mission/commands/{CommandType}`
- `GET /v1/missions?organization_id={id}`
- `GET /v1/missions/{id}?organization_id={id}`
- `GET /v1/missions/{id}/history?organization_id={id}&after_version=0&limit=100`
- `POST /v1/work/commands/CreateTask`
- `GET /v1/tasks?organization_id={id}`
- `GET /v1/tasks/{id}?organization_id={id}`
- `GET /v1/tasks/{id}/history?organization_id={id}&after_version=0&limit=100`
- `POST /v1/timeline/commands/CreateTimeline`
- `GET /v1/timelines?organization_id={id}`
- `GET /v1/timelines/{id}?organization_id={id}`
- `GET /v1/timelines/{id}/history?organization_id={id}&after_version=0&limit=100`
- `POST /v1/reporting-evidence/commands/CreateReport`
- `GET /v1/reports?organization_id={id}`
- `GET /v1/reports/{id}?organization_id={id}`
- `GET /v1/reports/{id}/history?organization_id={id}&after_version=0&limit=100`

Implemented command types:

- `CreateMission`
- `CreateBlueprintRevision`
- `SubmitBlueprint`
- `ActivateMission`
- `PauseMission`
- `ResumeMission`
- `CancelMission`
- `ArchiveMission`

See [Mission context](docs/mission-context.md) for lifecycle and authority details.

All command handlers share strict validation of the canonical v2.0 envelope before domain-specific payload checks. Emitted events are validated and their canonical integrity digests are verified before persistence. See [Runtime contract validation](docs/contract-validation.md).

The Work context currently implements `CreateTask`, the only Work command with a `FIELD_COMPLETE` payload. A task may be created only when its referenced Mission exists inside the same organization boundary. See [Work context](docs/work-context.md).

The Timeline context implements `CreateTimeline`. A timeline may currently target an existing Mission or Task inside the same organization boundary. See [Timeline context](docs/timeline-context.md).

The Reporting-Evidence context implements `CreateReport`. A report may currently target an existing Mission, Task, or Timeline inside the same organization boundary. See [Reporting-Evidence context](docs/reporting-evidence-context.md).

The HTTP adapter exposes every currently executable context. Other bounded contexts remain contract baselines until their payload schemas and architecture decisions are frozen.

## Contract maturity

The imported v2.0 package contains 294 command/event schemas. All 11 commands marked `FIELD_COMPLETE` now have executable handlers. Contracts marked `NAME_FROZEN_PAYLOAD_OPEN` are discoverable placeholders, not production-complete domain contracts.

`CloseMission`, `OperationalHaltMission`, and `RestartMission` are deliberately not implemented because their command payloads are still open.

Work lifecycle commands such as `StartTask`, `PauseTask`, `BlockTask`, and `CloseTask` are also deliberately unavailable until their command payloads are frozen. Timeline scheduling commands remain unavailable for the same reason.
