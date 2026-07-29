import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

export interface StoredOperation<TEvent> {
  fingerprint: string;
  event: TEvent;
}

export interface CommitRecord<TState, TEvent> {
  context: string;
  aggregateId: string;
  organizationId: string;
  version: number;
  state: TState;
  eventId: string;
  eventVersion: number;
  event: TEvent;
  operationId: string;
  fingerprint: string;
  create: boolean;
}

export interface OutboxMessage<TEvent = unknown> {
  eventId: string;
  context: string;
  aggregateId: string;
  organizationId: string;
  eventType: string;
  event: TEvent;
  attemptCount: number;
  availableAt: string;
  leaseOwner?: string;
  leaseExpiresAt?: string;
  deliveredAt?: string;
  deadLetteredAt?: string;
  lastError?: string;
}

export interface ClaimOutboxOptions {
  workerId: string;
  now: Date;
  leaseDurationMs: number;
  limit: number;
}

export class SqliteDatabase {
  readonly #database: DatabaseSync;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(resolve(path)), {recursive: true});
    this.#database = new DatabaseSync(path);
    this.#database.exec("PRAGMA foreign_keys = ON");
    this.#database.exec("PRAGMA busy_timeout = 5000");
    if (path !== ":memory:") this.#database.exec("PRAGMA journal_mode = WAL");
    this.#migrate();
  }

  close(): void {
    this.#database.close();
  }

  getState<TState>(context: string, aggregateId: string): TState | undefined {
    const row = this.#database.prepare(`
      SELECT state_json
      FROM onyx_aggregates
      WHERE context = ? AND aggregate_id = ?
    `).get(context, aggregateId) as {state_json: string} | undefined;
    return row ? JSON.parse(row.state_json) as TState : undefined;
  }

  listStates<TState>(context: string, organizationId: string): TState[] {
    const rows = this.#database.prepare(`
      SELECT state_json
      FROM onyx_aggregates
      WHERE context = ? AND organization_id = ?
      ORDER BY aggregate_id
    `).all(context, organizationId) as Array<{state_json: string}>;
    return rows.map((row) => JSON.parse(row.state_json) as TState);
  }

  getEvents<TEvent>(context: string, aggregateId: string, afterVersion: number, limit: number): TEvent[] {
    const rows = this.#database.prepare(`
      SELECT event_json
      FROM onyx_events
      WHERE context = ? AND aggregate_id = ? AND aggregate_version > ?
      ORDER BY aggregate_version
      LIMIT ?
    `).all(context, aggregateId, afterVersion, limit) as Array<{event_json: string}>;
    return rows.map((row) => JSON.parse(row.event_json) as TEvent);
  }

  getOperation<TEvent>(context: string, operationId: string): StoredOperation<TEvent> | undefined {
    const row = this.#database.prepare(`
      SELECT fingerprint, event_json
      FROM onyx_operations
      WHERE context = ? AND operation_id = ?
    `).get(context, operationId) as {fingerprint: string; event_json: string} | undefined;
    return row && {fingerprint: row.fingerprint, event: JSON.parse(row.event_json) as TEvent};
  }

  getOutboxMessage<TEvent>(eventId: string): OutboxMessage<TEvent> | undefined {
    const row = this.#database.prepare(`
      SELECT event_id, context, aggregate_id, organization_id, event_type, event_json,
             attempt_count, available_at, lease_owner, lease_expires_at,
             delivered_at, dead_lettered_at, last_error
      FROM onyx_outbox
      WHERE event_id = ?
    `).get(eventId) as OutboxRow | undefined;
    return row && toOutboxMessage<TEvent>(row);
  }

  claimOutbox<TEvent>(options: ClaimOutboxOptions): OutboxMessage<TEvent>[] {
    if (!options.workerId || !Number.isInteger(options.limit) || options.limit < 1 || options.limit > 1_000) {
      throw new Error("invalid outbox claim options");
    }
    if (!Number.isInteger(options.leaseDurationMs) || options.leaseDurationMs < 1) {
      throw new Error("outbox lease duration must be a positive integer");
    }
    const now = options.now.toISOString();
    const leaseExpiresAt = new Date(options.now.getTime() + options.leaseDurationMs).toISOString();
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      const rows = this.#database.prepare(`
        SELECT event_id, context, aggregate_id, organization_id, event_type, event_json,
               attempt_count, available_at, lease_owner, lease_expires_at,
               delivered_at, dead_lettered_at, last_error
        FROM onyx_outbox
        WHERE delivered_at IS NULL
          AND dead_lettered_at IS NULL
          AND available_at <= ?
          AND (lease_expires_at IS NULL OR lease_expires_at <= ?)
        ORDER BY created_at, event_id
        LIMIT ?
      `).all(now, now, options.limit) as unknown as OutboxRow[];
      const claim = this.#database.prepare(`
        UPDATE onyx_outbox
        SET lease_owner = ?, lease_expires_at = ?, attempt_count = attempt_count + 1
        WHERE event_id = ?
      `);
      for (const row of rows) claim.run(options.workerId, leaseExpiresAt, row.event_id);
      this.#database.exec("COMMIT");
      return rows.map((row) => toOutboxMessage<TEvent>({
        ...row,
        attempt_count: row.attempt_count + 1,
        lease_owner: options.workerId,
        lease_expires_at: leaseExpiresAt,
      }));
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
  }

  acknowledgeOutbox(eventId: string, workerId: string, deliveredAt: Date): void {
    const result = this.#database.prepare(`
      UPDATE onyx_outbox
      SET delivered_at = ?, lease_owner = NULL, lease_expires_at = NULL, last_error = NULL
      WHERE event_id = ? AND lease_owner = ?
        AND delivered_at IS NULL AND dead_lettered_at IS NULL
    `).run(deliveredAt.toISOString(), eventId, workerId);
    if (result.changes !== 1) throw new Error("outbox message is not leased by this worker");
  }

  rejectOutbox(
    eventId: string,
    workerId: string,
    error: string,
    failedAt: Date,
    retryAt: Date,
    maxAttempts: number,
  ): "retry" | "dead-letter" {
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1) throw new Error("maxAttempts must be a positive integer");
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      const row = this.#database.prepare(`
        SELECT attempt_count
        FROM onyx_outbox
        WHERE event_id = ? AND lease_owner = ?
          AND delivered_at IS NULL AND dead_lettered_at IS NULL
      `).get(eventId, workerId) as {attempt_count: number} | undefined;
      if (!row) throw new Error("outbox message is not leased by this worker");
      const lastError = error.slice(0, 2_048);
      const disposition = row.attempt_count >= maxAttempts ? "dead-letter" : "retry";
      if (disposition === "dead-letter") {
        this.#database.prepare(`
          UPDATE onyx_outbox
          SET dead_lettered_at = ?, lease_owner = NULL, lease_expires_at = NULL, last_error = ?
          WHERE event_id = ? AND lease_owner = ?
        `).run(failedAt.toISOString(), lastError, eventId, workerId);
      } else {
        this.#database.prepare(`
          UPDATE onyx_outbox
          SET available_at = ?, lease_owner = NULL, lease_expires_at = NULL, last_error = ?
          WHERE event_id = ? AND lease_owner = ?
        `).run(retryAt.toISOString(), lastError, eventId, workerId);
      }
      this.#database.exec("COMMIT");
      return disposition;
    } catch (failure) {
      this.#database.exec("ROLLBACK");
      throw failure;
    }
  }

  commit<TState, TEvent>(record: CommitRecord<TState, TEvent>): void {
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      const stateJson = JSON.stringify(record.state);
      if (record.create) {
        this.#database.prepare(`
          INSERT INTO onyx_aggregates(context, aggregate_id, organization_id, version, state_json)
          VALUES (?, ?, ?, ?, ?)
        `).run(record.context, record.aggregateId, record.organizationId, record.version, stateJson);
      } else {
        const result = this.#database.prepare(`
          UPDATE onyx_aggregates
          SET organization_id = ?, version = ?, state_json = ?, updated_at = CURRENT_TIMESTAMP
          WHERE context = ? AND aggregate_id = ? AND version = ?
        `).run(
          record.organizationId,
          record.version,
          stateJson,
          record.context,
          record.aggregateId,
          record.version - 1,
        );
        if (result.changes !== 1) throw new Error("aggregate version changed before commit");
      }

      const eventJson = JSON.stringify(record.event);
      this.#database.prepare(`
        INSERT INTO onyx_events(context, aggregate_id, aggregate_version, event_id, event_json)
        VALUES (?, ?, ?, ?, ?)
      `).run(record.context, record.aggregateId, record.eventVersion, record.eventId, eventJson);
      this.#database.prepare(`
        INSERT INTO onyx_operations(context, operation_id, fingerprint, event_json)
        VALUES (?, ?, ?, ?)
      `).run(record.context, record.operationId, record.fingerprint, eventJson);
      const event = record.event as Record<string, unknown>;
      this.#database.prepare(`
        INSERT INTO onyx_outbox(
          event_id, context, aggregate_id, organization_id, event_type, event_json, available_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        record.eventId,
        record.context,
        record.aggregateId,
        record.organizationId,
        typeof event.event_type === "string" ? event.event_type : "UnknownEvent",
        eventJson,
        typeof event.recorded_at === "string" ? event.recorded_at : new Date().toISOString(),
      );
      this.#database.exec("COMMIT");
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
  }

  #migrate(): void {
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS onyx_schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS onyx_aggregates (
        context TEXT NOT NULL,
        aggregate_id TEXT NOT NULL,
        organization_id TEXT NOT NULL,
        version INTEGER NOT NULL CHECK(version >= 1),
        state_json TEXT NOT NULL CHECK(json_valid(state_json)),
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY(context, aggregate_id)
      );

      CREATE INDEX IF NOT EXISTS onyx_aggregates_organization
        ON onyx_aggregates(context, organization_id, aggregate_id);

      CREATE TABLE IF NOT EXISTS onyx_events (
        context TEXT NOT NULL,
        aggregate_id TEXT NOT NULL,
        aggregate_version INTEGER NOT NULL CHECK(aggregate_version >= 1),
        event_id TEXT NOT NULL UNIQUE,
        event_json TEXT NOT NULL CHECK(json_valid(event_json)),
        recorded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY(context, aggregate_id, aggregate_version),
        FOREIGN KEY(context, aggregate_id)
          REFERENCES onyx_aggregates(context, aggregate_id)
          ON DELETE RESTRICT
      );

      CREATE TABLE IF NOT EXISTS onyx_operations (
        context TEXT NOT NULL,
        operation_id TEXT NOT NULL,
        fingerprint TEXT NOT NULL,
        event_json TEXT NOT NULL CHECK(json_valid(event_json)),
        recorded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY(context, operation_id)
      );

      CREATE TABLE IF NOT EXISTS onyx_outbox (
        event_id TEXT PRIMARY KEY,
        context TEXT NOT NULL,
        aggregate_id TEXT NOT NULL,
        organization_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        event_json TEXT NOT NULL CHECK(json_valid(event_json)),
        attempt_count INTEGER NOT NULL DEFAULT 0 CHECK(attempt_count >= 0),
        available_at TEXT NOT NULL,
        lease_owner TEXT,
        lease_expires_at TEXT,
        delivered_at TEXT,
        dead_lettered_at TEXT,
        last_error TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(event_id) REFERENCES onyx_events(event_id) ON DELETE RESTRICT,
        CHECK(NOT (delivered_at IS NOT NULL AND dead_lettered_at IS NOT NULL)),
        CHECK((lease_owner IS NULL) = (lease_expires_at IS NULL))
      );

      CREATE INDEX IF NOT EXISTS onyx_outbox_ready
        ON onyx_outbox(delivered_at, dead_lettered_at, available_at, lease_expires_at);

      INSERT OR IGNORE INTO onyx_schema_migrations(version) VALUES (1);
      INSERT OR IGNORE INTO onyx_schema_migrations(version) VALUES (2);
    `);
  }
}

interface OutboxRow {
  event_id: string;
  context: string;
  aggregate_id: string;
  organization_id: string;
  event_type: string;
  event_json: string;
  attempt_count: number;
  available_at: string;
  lease_owner: string | null;
  lease_expires_at: string | null;
  delivered_at: string | null;
  dead_lettered_at: string | null;
  last_error: string | null;
}

function toOutboxMessage<TEvent>(row: OutboxRow): OutboxMessage<TEvent> {
  return {
    eventId: row.event_id,
    context: row.context,
    aggregateId: row.aggregate_id,
    organizationId: row.organization_id,
    eventType: row.event_type,
    event: JSON.parse(row.event_json) as TEvent,
    attemptCount: row.attempt_count,
    availableAt: row.available_at,
    ...(row.lease_owner !== null ? {leaseOwner: row.lease_owner} : {}),
    ...(row.lease_expires_at !== null ? {leaseExpiresAt: row.lease_expires_at} : {}),
    ...(row.delivered_at !== null ? {deliveredAt: row.delivered_at} : {}),
    ...(row.dead_lettered_at !== null ? {deadLetteredAt: row.dead_lettered_at} : {}),
    ...(row.last_error !== null ? {lastError: row.last_error} : {}),
  };
}
