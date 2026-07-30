# Approval context

C10 owns auditable decision gates over existing ONYX objects. A request identifies its subject, requester, and approval threshold. Active users may be assigned as reviewers, delegate a pending assignment, or be added through escalation. Approve, reject, and request-changes decisions are accepted only from assigned pending approvers.

Rejection, requested changes, cancellation, final approval, reversal, and reopen transitions advance the lifecycle epoch. Reopening resets non-delegated reviewer decisions while preserving the assignment and escalation trail. Every command enforces exact payload keys, organization ownership, authority scope, optimistic version and epoch fences, operation idempotency, atomic SQLite event/state/outbox persistence, and integrity-checked audit envelopes.

All ten commands are available at `/v1/approval/commands/{CommandType}`. Collection, item, and history queries are exposed under `/v1/approvals`.
