# Persistence

ONYX provides in-memory and SQLite repository adapters. Domain and application services depend only on repository interfaces, so selecting persistence does not alter contract execution.

## Enable SQLite

```bash
ONYX_DB_PATH=./data/onyx.db npm start
```

The parent directory is created automatically. SQLite enables foreign keys, a five-second busy timeout, and write-ahead logging for file-backed databases.

## Storage model

The initial migration creates:

- `onyx_aggregates` for current aggregate snapshots;
- `onyx_events` for immutable ordered aggregate events;
- `onyx_operations` for idempotency fingerprints and original results;
- `onyx_outbox` for reliable asynchronous event delivery;
- `onyx_inbox` for per-consumer event deduplication and processing leases;
- `onyx_schema_migrations` for migration history.

Every key includes a bounded-context identifier, so none of the 18 executable contexts can overwrite another context's aggregate or operation identifiers.

## Atomic commit

A command commit runs inside `BEGIN IMMEDIATE` and writes:

1. the new aggregate snapshot;
2. the immutable event;
3. the operation-id record;
4. a pending outbox message containing the exact persisted event.

Any failed statement rolls the transaction back. Updates also compare the stored aggregate version with the immediately preceding version, providing a persistence-level optimistic concurrency guard in addition to application validation.

For all 18 executable contexts, events read from aggregate history, the operation-idempotency store, or the outbox are revalidated against their context-specific event whitelist, canonical envelope, aggregate type, and integrity digest. Row metadata such as event ID, type, organization, aggregate identity, version, and operation ID must agree with the event body. Corruption fails closed as an internal storage error; outbox rows are validated before lease acquisition so a damaged message is not hidden behind a fresh lease. Contract validation reconciles these whitelists with all 150 event schemas so a context or event cannot silently bypass the check.

## Recovery behavior

Restart tests close the database, construct new repository and service instances, and verify:

- aggregate snapshots are restored for every executable context;
- ordered history remains available;
- identical command replay returns the original event;
- cross-context references remain resolvable through their owning services;
- Timeline due signals remain exactly-once across restart;
- corrupted events in both core and later contexts fail closed during history reads.

The implementation currently uses Node's built-in `node:sqlite` module. Node 24 still reports this module as experimental, so the runtime version must remain pinned and persistence conformance tests must run before upgrades.

File-backed databases support verified online backups and create-only restores. See [Backup and disaster recovery](disaster-recovery.md).

## Outbox delivery

`OutboxDispatcher.runOnce()` claims a bounded batch using an exclusive, expiring lease. A successful publisher call acknowledges the message. A failed call releases it with exponential backoff; after the configured attempt limit it is moved to the dead-letter state for operator inspection.

Delivery is **at least once**. A publisher may complete immediately before its acknowledgement is interrupted, so downstream consumers must deduplicate using the stable `event_id`. Lease expiry allows another worker to recover messages from a crashed process, while owner-checked acknowledgement prevents a stale worker from completing a newer worker's lease.

The dispatcher deliberately performs one bounded pass. `OutboxWorker` runs those passes without overlap, continues immediately while a backlog exists, delays after infrastructure errors, and interrupts idle waits during shutdown. The built-in production adapter posts canonical events to a credential-free HTTPS URL with redirects disabled; see [Production deployment](deployment.md).

## Inbox processing

`InboxProcessor.process()` stores receipts under the compound identity `(consumer_name, event_id)`. Completed receipts permanently suppress redelivery for that consumer, while another consumer remains free to process the same event. A SHA-256 fingerprint rejects reuse of an event identifier with changed content.

An expiring lease prevents two workers for the same consumer from concurrently handling an event. Failed handlers release the lease and preserve a bounded diagnostic message; a crashed worker's lease can be recovered after expiry. Completion is owner-checked so a stale worker cannot overwrite a recovered receipt.

The inbox closes the normal duplicate-redelivery path, but an arbitrary external side effect and the receipt cannot form one atomic transaction. Handlers must therefore be naturally idempotent, or persist their side effect and receipt in the same transactional resource when exactly-once local state changes are required.
