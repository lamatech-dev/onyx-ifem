# Automation context

C14 owns deterministic automation-rule state and execution receipts. A rule fixes an active owner, trigger kind and expression, action kind, and bounded string configuration. Rules start disabled and must be enabled before evaluation or execution. Evaluations capture their exact input; action executions reference an existing evaluation and retain their result.

Retry attempts are monotonic and record a failed execution with its reason. Compensation is explicit and terminal for that execution receipt. Enable, disable, and archive transitions advance the lifecycle epoch; archived rules are immutable. All commands enforce exact payloads, authority scopes, organization isolation, optimistic fences, idempotency, atomic SQLite state/event/outbox persistence, and event-integrity validation.

All eight commands use `/v1/automation/commands/{CommandType}`. Rule queries and histories use `/v1/automation-rules`.
