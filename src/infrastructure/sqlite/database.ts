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

      INSERT OR IGNORE INTO onyx_schema_migrations(version) VALUES (1);
    `);
  }
}
