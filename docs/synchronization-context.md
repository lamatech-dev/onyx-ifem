# Synchronization context (C16)

C16 owns auditable replica convergence for an operational subject. Synchronizations exchange immutable operation batches, merge monotonic vector clocks, detect field conflicts, and require explicit resolution before closure.

The lifecycle is `ACTIVE → CONFLICTED → ACTIVE/SYNCHRONIZED → CLOSED`. A batch must be offered before acceptance and accepted before merge. Accepted operations must be a subset of the offer. Merge records every conflict; open conflicts may be escalated to an active user and resolved with a local, remote, or custom value. Both participating replicas can acknowledge the converged clock.

All eight commands use `/v1/synchronization/commands/{CommandType}`. Queries and histories use `/v1/synchronizations`. State, events, operation fingerprints, and outbox records commit atomically in SQLite; retries with the same operation ID are deterministic.
