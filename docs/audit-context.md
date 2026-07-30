# Audit context (C17)

C17 owns append-only, tamper-evident audit partitions. Each entry carries an external integrity digest and extends a deterministic SHA-256 root chain. Open partitions accept unique entries; sealing requires an exact entry count and freezes the ledger.

Sealed partitions support bounded JSONL or CSV exports and integrity verification against an expected root. Verification records both expected and actual roots and its validity result. Only sealed partitions can be archived. State, events, operation fingerprints, and outbox messages commit atomically and survive restart.

All five commands use `/v1/audit/commands/{CommandType}`. Queries and histories use `/v1/audit-partitions`.
