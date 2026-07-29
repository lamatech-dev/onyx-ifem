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
- `onyx_schema_migrations` for migration history.

Every key includes a bounded-context identifier. Mission, Work, Timeline, and Reporting-Evidence therefore cannot overwrite each other's aggregate or operation identifiers.

## Atomic commit

A command commit runs inside `BEGIN IMMEDIATE` and writes:

1. the new aggregate snapshot;
2. the immutable event;
3. the operation-id record;
4. a pending outbox message containing the exact persisted event.

Any failed statement rolls the transaction back. Updates also compare the stored aggregate version with the immediately preceding version, providing a persistence-level optimistic concurrency guard in addition to application validation.

## Recovery behavior

Restart tests close the database, construct new repository and service instances, and verify:

- aggregate snapshots are restored;
- ordered history remains available;
- identical command replay returns the original event;
- Work references remain resolvable through the Mission boundary;
- Timeline state and idempotency survive restart while subjects remain resolvable through their owning context.
- Report state, event history, and idempotency survive restart while subjects remain resolvable through their owning context.

The implementation currently uses Node's built-in `node:sqlite` module. Node 24 still reports this module as experimental, so the runtime version must remain pinned and persistence conformance tests must run before upgrades.

## Outbox delivery

`OutboxDispatcher.runOnce()` claims a bounded batch using an exclusive, expiring lease. A successful publisher call acknowledges the message. A failed call releases it with exponential backoff; after the configured attempt limit it is moved to the dead-letter state for operator inspection.

Delivery is **at least once**. A publisher may complete immediately before its acknowledgement is interrupted, so downstream consumers must deduplicate using the stable `event_id`. Lease expiry allows another worker to recover messages from a crashed process, while owner-checked acknowledgement prevents a stale worker from completing a newer worker's lease.

The dispatcher deliberately performs one bounded pass. Production runtimes should invoke it from their existing worker loop or scheduler, provide the broker-specific `publish` callback, and stop scheduling new passes during graceful shutdown. Broker credentials and transport policy therefore remain outside the domain and persistence layers.
