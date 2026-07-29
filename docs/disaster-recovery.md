# Backup and disaster recovery

ONYX uses SQLite's Online Backup API through Node's built-in `node:sqlite.backup()`. Backups can be taken while the application is running in WAL mode; copying only the main `.db` file while it is live is not a supported backup procedure.

## Create and verify a backup

```bash
npm run db:backup -- /var/lib/onyx/onyx.db /var/backups/onyx/onyx-2026-07-29.db
npm run db:verify -- /var/backups/onyx/onyx-2026-07-29.db
```

Backup creation writes a unique partial file, runs `PRAGMA integrity_check` and `PRAGMA foreign_key_check`, computes a streaming SHA-256 digest, writes a manifest, and publishes both with create-only filesystem links. Existing destinations are never overwritten. Database and manifest files are created with mode `0600`.

The adjacent `.manifest.json` records the backup filename, creation time, byte length, page count, SHA-256 digest, SQLite version, required tables, and applied ONYX schema migrations. Verification checks the digest and size before opening the database.

The manifest detects accidental corruption but is not a digital signature. Store backups and manifests in immutable, access-controlled storage and apply platform encryption. An attacker able to replace both files can generate a new matching digest.

## Restore rehearsal

Restore into a new, absent path:

```bash
npm run db:restore -- \
  /var/backups/onyx/onyx-2026-07-29.db \
  /var/lib/onyx-restore/onyx.db
```

Restore verifies the source backup first, uses the SQLite Backup API to create a fresh database, repeats integrity and foreign-key checks, compares schema versions, and atomically publishes the destination without overwrite.

Before production use, start an isolated ONYX instance against the restored file and exercise `/readyz`, representative reads, command idempotency replay, event history, and outbox delivery. Never point two active environments at the same restored file.

## Production cutover

1. Stop all API and outbox-worker instances that use the failed database.
2. Preserve the failed database, WAL, and SHM files for investigation; do not overwrite them.
3. Verify the selected backup and restore it to a new path.
4. Update `ONYX_DB_PATH` to the restored path.
5. Start one instance, confirm readiness and data checks, then scale out.
6. Monitor outbox redelivery and downstream inbox deduplication.

Restoring an older snapshot reintroduces its pending outbox records. At-least-once redelivery is expected; receivers must deduplicate using the stable event ID.

## Recovery objectives

Choose the backup interval from the required recovery-point objective (RPO), not convenience. Measure recovery-time objective (RTO) through scheduled restore rehearsals using production-scale encrypted copies. Retention should include multiple generations and at least one independently administered location.

The runtime refuses a database whose migration version is newer than the executable supports. This prevents an older deployment from mutating a database created by newer code. Upgrade the executable instead of editing migration markers.

The implementation follows the official [Node.js SQLite backup API](https://nodejs.org/download/release/latest-v24.x/docs/api/sqlite.html#sqlitebackupsource-db-path-options) and SQLite's [Online Backup API](https://www.sqlite.org/backup.html) and [integrity-check documentation](https://www.sqlite.org/pragma.html#pragma_integrity_check).
