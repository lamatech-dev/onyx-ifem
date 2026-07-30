# Policy context (C18)

C18 owns versioned operational policy, deterministic evaluation, violations, legal holds, quota signals, and rate limiting. Policies begin as drafts, collect immutable rule versions, and become active when a version is published. Publishing advances the lifecycle epoch and selects exactly one active version.

Evaluations resolve matching resource/action rules with explicit deny precedence and persist the decision and matched rule IDs. Rate-limit policies additionally define bounded windows, request limits, quotas, and warning thresholds. Evaluation emits `QuotaThresholdReached`, `QuotaExceeded`, or `RateLimitTriggered` when the corresponding measured boundary is crossed.

Violations reference an existing evaluation. Legal holds reference an existing operational object and active user; a policy cannot retire while any hold remains active. All state, events, operation fingerprints, and outbox records commit atomically in SQLite.

All nine commands use `/v1/policy/commands/{CommandType}`. Queries and histories use `/v1/policies`.
