# Context Link context

The Context Link context owns cross-domain relationships without taking ownership of either endpoint. It implements all five v2.0 commands with exact payload schemas.

## Link model

A Context Link identifies a source and target using canonical domain-object references, a relation type, one of four strengths, and bounded string metadata. Self-links are rejected. Creation resolves both endpoints through their owning query services and requires both objects to exist inside the command organization.

Supported endpoint owners currently include Organization, User, Mission, Task, Timeline, and Report. New aggregate types are added to the resolver when their bounded contexts become executable.

## Lifecycle

- `CreateContextLink` emits `ContextLinkCreated`.
- `UpdateContextMetadata` replaces the metadata map and emits `ContextMetadataUpdated`.
- `ChangeContextStrength` emits `ContextStrengthChanged` and rejects no-op changes.
- `ArchiveContextLink` emits `ContextLinkArchived` and advances the lifecycle epoch.
- `RestoreContextLink` revalidates both endpoints, emits `ContextLinkRestored`, and advances the lifecycle epoch again.

Archived links cannot be changed until restored. Every mutation enforces organization ownership, authority scope, optimistic version, lifecycle and authority fences, and idempotency fingerprints.

## Persistence and API

Snapshot, event, operation receipt, and outbox message are committed atomically in both in-memory and SQLite repository implementations. Collection, item, and bounded history routes are available under `/v1/context-links`.

The command center renders each link as a source-node, labeled edge, and target-node graph card. Controls cover all five commands, including metadata, strength, archive, and restore transitions.
