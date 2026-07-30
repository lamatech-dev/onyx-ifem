# Capacity context

C12 owns organization-scoped resource capacity. A profile binds an active user or organization resource to a unit (`HOURS`, `POINTS`, or `PERCENT`). Availability is defined by exact UTC periods; workload allocations reference existing Tasks or Missions and retain their own period and unit quantity.

The aggregate recalculates available, allocated, and remaining totals after every relevant mutation. Named snapshots preserve point-in-time totals, while explicit recalculation records its `as_of` instant. Archive is terminal and advances the lifecycle epoch. All commands enforce exact payloads, valid periods, authority, organization isolation, optimistic fences, idempotency, atomic SQLite state/event/outbox persistence, and audit integrity.

All six commands are exposed under `/v1/capacity/commands/{CommandType}`. Queries and event history use `/v1/capacity-profiles`.
