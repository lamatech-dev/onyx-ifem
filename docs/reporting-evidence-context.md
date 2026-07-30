# Reporting-Evidence context

The Reporting-Evidence context owns Report aggregates and implements every v2.0 command in the context with exact payload schemas.

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

## Evidence and review lifecycle

- Evidence records carry a stable identifier, type, URI, SHA-256 digest, and verification state.
- Evidence may be added, verified, or rejected while a report is editable.
- Submission requires at least one verified evidence item.
- Submitted reports may be approved or rejected; rejected reports can be revised and resubmitted using a new lifecycle epoch.
- Approved or rejected reports may be archived, after which they are immutable.

Every mutation enforces authority scope, organization ownership, version and epoch fences, idempotency, and atomic state/event persistence.
