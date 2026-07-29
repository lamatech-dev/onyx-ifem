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
- `onyx_schema_migrations` for migration history.

Every key includes a bounded-context identifier. Mission, Work, and Timeline therefore cannot overwrite each other's aggregate or operation identifiers.

## Atomic commit

A command commit runs inside `BEGIN IMMEDIATE` and writes:

1. the new aggregate snapshot;
2. the immutable event;
3. the operation-id record.

Any failed statement rolls the transaction back. Updates also compare the stored aggregate version with the immediately preceding version, providing a persistence-level optimistic concurrency guard in addition to application validation.

## Recovery behavior

Restart tests close the database, construct new repository and service instances, and verify:

- aggregate snapshots are restored;
- ordered history remains available;
- identical command replay returns the original event;
- Work references remain resolvable through the Mission boundary;
- Timeline state and idempotency survive restart while subjects remain resolvable through their owning context.

The implementation currently uses Node's built-in `node:sqlite` module. Node 24 still reports this module as experimental, so the runtime version must remain pinned and persistence conformance tests must run before upgrades.
