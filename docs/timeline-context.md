# Timeline context

The Timeline context owns Timeline aggregates and implements every v2.0 Timeline command with exact payload schemas.

## Contract mapping

`CreateTimeline@1` emits `TimelineCreated@1` without adding fields to the frozen payload. The aggregate stores:

- `timeline_id`;
- the referenced domain subject;
- the non-empty timezone string supplied by the caller;
- organization ownership and aggregate version.

The command target must identify the same Timeline as `payload.timeline_id`. Creation starts at aggregate version 1 and requires an absent or zero `expected_version`.

## Subject boundary

Timeline references its subject but does not modify it. `TimelineService` depends on a narrow `requireSubject(organizationId, subjectRef)` port. The current server composition resolves Mission and Task subjects through their query services and requires them to belong to the same organization. Unsupported subject types are rejected until their owning contexts exist in the runtime.

## Authority and replay

Creation requires an unexpired authority proof containing `timeline:create`. The operation identifier and canonical command fingerprint are persisted alongside the event. An identical replay returns the original `TimelineCreated` event; changed reuse returns `IDEMPOTENCY_KEY_REUSE`.

## Query surface

- get a Timeline by identifier and organization;
- list Timelines inside an organization;
- read aggregate event history using `after_version` and `limit` bounds.

## Scheduling operations

- `SetDeadline` and `MoveDeadline` maintain identified deadlines.
- `AddMilestone` records named due points.
- `DefineCriticalMarker` records decision boundaries.
- `ActivatePenaltyZone` records late-delivery enforcement windows.
- `ResolveScheduleException` permanently deduplicates resolved exception identifiers.
- `ArchiveTimeline` increments the lifecycle epoch and makes the aggregate immutable.
- A read-side due-signal sweep emits `DeadlineReached` and `CriticalMarkerReached` exactly once when their UTC instants pass. Reached identifiers are persisted with each event, so process restarts and repeated reads cannot duplicate a signal.

Every mutation enforces organization ownership, authority scope, optional version/epoch fences, idempotency, and atomic event persistence in both repository adapters.
