# ONYX IFEM

ONYX is an interface-first execution framework. This repository turns the IFEM v2.0 contract baseline into an executable, independently testable system.

The first implementation slice is the Mission context. It accepts the published `CreateMission` command envelope, enforces authority and idempotency rules, persists a mission aggregate, and emits a canonical `MissionCreated` event.

## Repository layout

```text
contracts/v2.0/       Versioned machine-readable contract baseline
src/contracts/        Canonical envelope and shared runtime types
src/mission/          Mission domain, service, repository, and HTTP adapter
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
npm run start:mission
```

The server listens on `127.0.0.1:3000` by default. Configure `ONYX_HOST`, `ONYX_PORT`, and `ONYX_REPLICA_ID` when needed.

Available endpoints:

- `GET /healthz`
- `POST /v1/mission/commands/CreateMission`

The HTTP adapter intentionally starts with one complete vertical slice. Other bounded contexts remain contract baselines until their payload schemas and architecture decisions are frozen.

## Contract maturity

The imported v2.0 package contains 294 command/event schemas. Only contracts marked `FIELD_COMPLETE` should be treated as fully constrained payloads. Contracts marked `NAME_FROZEN_PAYLOAD_OPEN` are discoverable placeholders, not production-complete domain contracts.

