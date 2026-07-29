# Timeline context

The Timeline context owns Timeline aggregates. The initial vertical slice implements `CreateTimeline`, the only Timeline command whose v2.0 payload is marked `FIELD_COMPLETE`.

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

## Deferred scheduling

Commands for milestones, deadlines, critical markers, penalty zones, exceptions, and archival remain unavailable because their payload schemas are `NAME_FROZEN_PAYLOAD_OPEN`. The implementation does not infer fields or state transitions for those contracts.
