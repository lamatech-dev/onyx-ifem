# Reporting-Evidence context

The Reporting-Evidence context owns Report aggregates. The initial vertical slice implements `CreateReport`, the only command in this context whose v2.0 payload is marked `FIELD_COMPLETE`.

## Contract mapping

`CreateReport@1` emits `ReportCreated@1` without adding fields to the frozen payload. The aggregate stores:

- `report_id` and `report_type`;
- the referenced domain subject;
- `author_id` and the non-empty title;
- organization ownership and aggregate version.

The command target must identify the same Report as `payload.report_id`. Creation starts at aggregate version 1 and requires an absent or zero `expected_version`.

## Subject boundary

Reporting-Evidence references its subject but does not modify it. `ReportingService` depends on a narrow `requireSubject(organizationId, subjectRef)` port. The current server composition resolves Mission, Task, and Timeline subjects through their query services and requires them to belong to the same organization. Unsupported subject types remain unavailable until their owning contexts are implemented.

## Authority and replay

Creation requires an unexpired authority proof containing `reporting-evidence:create`. The operation identifier and canonical command fingerprint are committed with the aggregate snapshot and event. An identical replay returns the original `ReportCreated` event; changed reuse returns `IDEMPOTENCY_KEY_REUSE`.

## Query surface

- get a Report by identifier and organization;
- list Reports inside an organization;
- read aggregate event history using `after_version` and `limit` bounds.

## Deferred evidence lifecycle

Adding and verifying evidence, submission, approval, rejection, and archival remain unavailable because their command payload schemas are `NAME_FROZEN_PAYLOAD_OPEN`. The implementation does not invent their fields or state transitions.
