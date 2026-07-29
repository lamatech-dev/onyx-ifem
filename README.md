# ONYX IFEM

ONYX is an interface-first execution framework. This repository turns the IFEM v2.0 contract baseline into an executable, independently testable system.

The executable baseline includes the Mission, Work, Timeline, and Reporting-Evidence contexts. It implements every v2.0 command whose payload is marked `FIELD_COMPLETE`, enforces authority, optimistic concurrency, idempotency, and organization boundaries, persists state with its events, and exposes read APIs.

## Repository layout

```text
contracts/v2.0/       Versioned machine-readable contract baseline
src/contracts/        Canonical envelope and shared runtime types
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

No third-party runtime or test dependencies are required for the initial slice.

## Verify

```bash
npm run check
```

## Run the Mission API

```bash
npm start
```

The server listens on `127.0.0.1:3000` by default. Configure `ONYX_HOST`, `ONYX_PORT`, and replica identifiers when needed.

State is in-memory unless `ONYX_DB_PATH` is set. Enable durable SQLite persistence with:

```bash
ONYX_DB_PATH=./data/onyx.db npm start
```

Mission, Work, Timeline, and Reporting-Evidence keep separate context ownership while sharing the same transactional database. See [Persistence](docs/persistence.md).

Available endpoints:

- `GET /healthz`
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

All command handlers share strict validation of the canonical v2.0 envelope before domain-specific payload checks. See [Runtime contract validation](docs/contract-validation.md).

The Work context currently implements `CreateTask`, the only Work command with a `FIELD_COMPLETE` payload. A task may be created only when its referenced Mission exists inside the same organization boundary. See [Work context](docs/work-context.md).

The Timeline context implements `CreateTimeline`. A timeline may currently target an existing Mission or Task inside the same organization boundary. See [Timeline context](docs/timeline-context.md).

The Reporting-Evidence context implements `CreateReport`. A report may currently target an existing Mission, Task, or Timeline inside the same organization boundary. See [Reporting-Evidence context](docs/reporting-evidence-context.md).

The HTTP adapter intentionally starts with one complete vertical slice. Other bounded contexts remain contract baselines until their payload schemas and architecture decisions are frozen.

## Contract maturity

The imported v2.0 package contains 294 command/event schemas. All 11 commands marked `FIELD_COMPLETE` now have executable handlers. Contracts marked `NAME_FROZEN_PAYLOAD_OPEN` are discoverable placeholders, not production-complete domain contracts.

`CloseMission`, `OperationalHaltMission`, and `RestartMission` are deliberately not implemented because their command payloads are still open.

Work lifecycle commands such as `StartTask`, `PauseTask`, `BlockTask`, and `CloseTask` are also deliberately unavailable until their command payloads are frozen. Timeline scheduling commands remain unavailable for the same reason.
