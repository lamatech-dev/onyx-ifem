# Conversation context

The Conversation context owns operational communication rooms and implements all eight v2.0 commands with exact payload schemas.

## Membership and topic boundary

A conversation is created by an existing active User, who becomes its owner member. An optional topic reference is resolved through the owning context and must belong to the same organization. Additional members must also be active organization Users.

## Message integrity

Only members may post messages or react. A message can be edited only by its original author; each edit increments an explicit count and emits an immutable event containing the new body. Reaction identity combines the member and reaction value, making add/remove operations deterministic and duplicate-safe.

Redaction is intentionally destructive in the current snapshot: the body is replaced with `[REDACTED]`, all reactions are removed, and only the redaction reason remains in the event stream. Redacted messages cannot be edited or reacted to.

## Lifecycle and reliability

Archival advances the lifecycle epoch and makes the conversation immutable. All mutations enforce dedicated scopes, organization ownership, optimistic version, lifecycle and authority fencing, idempotency, and canonical event integrity. SQLite persistence atomically records state, event, operation receipt, and outbox message.

Collection, item, and bounded history APIs are exposed under `/v1/conversations`. The graphical command center renders members and a chat stream and supplies controls for creation, membership, posting, editing, reaction add/remove, redaction, and archival.
