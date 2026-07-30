# File context

C08 owns file-asset metadata and deterministic upload state. `CreateFileAsset` establishes the organization-bound owner. Uploads declare expected size, chunk size, and final SHA-256 digest; chunks are accepted once by index and finalization succeeds only when the accepted byte total and digest match. Finalized uploads may become immutable named versions.

Access grants are explicit principal-reference and `READ`, `WRITE`, or `ADMIN` permission triples. Quarantine advances the lifecycle epoch and blocks new uploads; archive is terminal and advances it again. Every mutation enforces exact payload keys, authority scope, optimistic version and epoch fences, organization isolation, idempotency, atomic SQLite state/event/outbox persistence, and audit-integrity validation.

The API exposes all nine commands under `/v1/file/commands/{CommandType}` and list, item, and history queries under `/v1/files`.
