# Notification context

C15 owns auditable notification intent, recipient resolution, delivery batches, escalation, and acknowledgement. A notification may reference an existing operational source and fixes its severity and creator. Resolution validates every active user and assigns one or more unique delivery channels before sending.

Sending creates an immutable batch receipt and advances the lifecycle epoch. Retry attempts are monotonic and preserve delivery failure reasons. Escalation adds an active user through the in-app channel; acknowledgement is accepted only for a resolved recipient. Archive is terminal and advances the epoch. Every command enforces exact payloads, organization isolation, authority, optimistic fences, idempotency, atomic SQLite state/event/outbox persistence, and audit integrity.

All seven commands use `/v1/notification/commands/{CommandType}`. Queries and histories use `/v1/notifications`.
