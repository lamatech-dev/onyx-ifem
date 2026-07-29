# Mission context

The Mission context is the first executable ONYX bounded context. Its application service accepts canonical command envelopes and returns canonical event envelopes. Aggregate state, event history, and operation-id records are committed together by the repository boundary.

## Lifecycle

```mermaid
stateDiagram-v2
  [*] --> DRAFT: CreateMission
  DRAFT --> PLANNING: CreateBlueprintRevision
  PLANNING --> PLANNING: CreateBlueprintRevision
  DRAFT --> AWAITING_APPROVAL: SubmitBlueprint
  PLANNING --> AWAITING_APPROVAL: SubmitBlueprint
  AWAITING_APPROVAL --> ACTIVE: ActivateMission
  ACTIVE --> PAUSED: PauseMission
  PAUSED --> ACTIVE: ResumeMission
  DRAFT --> CANCELLED: CancelMission
  PLANNING --> CANCELLED: CancelMission
  AWAITING_APPROVAL --> CANCELLED: CancelMission
  ACTIVE --> CANCELLED: CancelMission
  PAUSED --> CANCELLED: CancelMission
  CANCELLED --> ARCHIVED: ArchiveMission
```

Transitions involving `CLOSED`, `HALTED`, or restart behavior remain unavailable until the corresponding command payloads are frozen.

## Command authority scopes

| Command | Required scope |
| --- | --- |
| `CreateMission` | `mission:create` |
| `CreateBlueprintRevision` | `mission:blueprint:create` |
| `SubmitBlueprint` | `mission:blueprint:submit` |
| `ActivateMission` | `mission:activate` |
| `PauseMission` | `mission:pause` |
| `ResumeMission` | `mission:resume` |
| `CancelMission` | `mission:cancel` |
| `ArchiveMission` | `mission:archive` |

Authority proofs must be unexpired. Optional expected version, lifecycle epoch, and authority epoch values are checked before mutation.

## Idempotency and consistency

- Replaying an identical `operation_id` returns the original event.
- Reusing an `operation_id` with different command content is rejected.
- Mutations may provide `expected_version` for optimistic concurrency.
- Organization boundaries are checked before exposing or mutating an aggregate.
- Aggregate state, emitted event, and operation record share one repository commit boundary.
- Event integrity metadata contains a SHA-256 digest over canonical event content.

The current repository adapter is in-memory. Its interface is intentionally shaped so a durable database adapter can preserve the same atomic commit boundary in the next infrastructure phase.

