import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { validateEventEnvelope } from "../../contracts/validation.ts";

export const SQLITE_SCHEMA_VERSION = 4;

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
  aggregateVersion: number;
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

export interface InboxReceipt {
  consumerName: string;
  eventId: string;
  fingerprint: string;
  attemptCount: number;
  receivedAt: string;
  leaseOwner?: string;
  leaseExpiresAt?: string;
  completedAt?: string;
  lastError?: string;
}

export interface ClaimInboxOptions {
  consumerName: string;
  eventId: string;
  fingerprint: string;
  workerId: string;
  now: Date;
  leaseDurationMs: number;
}

export type InboxClaim =
  | {status: "acquired"; receipt: InboxReceipt}
  | {status: "duplicate"; receipt: InboxReceipt}
  | {status: "busy"; receipt: InboxReceipt};

export interface MessagingSnapshot {
  outbox: {
    pending: number;
    ready: number;
    leased: number;
    delivered: number;
    deadLettered: number;
    oldestPendingAt?: string;
  };
  inbox: {
    processing: number;
    retryable: number;
    completed: number;
    failed: number;
  };
}

export class SqliteDatabase {
  readonly #database: DatabaseSync;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(resolve(path)), {recursive: true});
    this.#database = new DatabaseSync(path);
    try {
      this.#database.exec("PRAGMA foreign_keys = ON");
      this.#database.exec("PRAGMA busy_timeout = 5000");
      this.#assertNoFutureSchema();
      if (path !== ":memory:") this.#database.exec("PRAGMA journal_mode = WAL");
      this.#migrate();
    } catch (error) {
      this.#database.close();
      throw error;
    }
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

  listStates<TState>(context: string, organizationId: string, afterId: string | undefined, limit: number): TState[] {
    const rows = this.#database.prepare(`
      SELECT state_json
      FROM onyx_aggregates
      WHERE context = ? AND organization_id = ? AND (? IS NULL OR aggregate_id > ?)
      ORDER BY aggregate_id
      LIMIT ?
    `).all(context, organizationId, afterId ?? null, afterId ?? null, limit) as Array<{state_json: string}>;
    return rows.map((row) => JSON.parse(row.state_json) as TState);
  }

  getEvents<TEvent>(context: string, aggregateId: string, afterVersion: number, limit: number): TEvent[] {
    const rows = this.#database.prepare(`
      SELECT aggregate_version, event_id, event_json
      FROM onyx_events
      WHERE context = ? AND aggregate_id = ? AND aggregate_version > ?
      ORDER BY aggregate_version
      LIMIT ?
    `).all(context, aggregateId, afterVersion, limit) as Array<{aggregate_version: number; event_id: string; event_json: string}>;
    return rows.map((row) => storedEvent<TEvent>(row.event_json, {
      context,
      aggregateId,
      aggregateVersion: row.aggregate_version,
      eventId: row.event_id,
    }));
  }

  getOperation<TEvent>(context: string, operationId: string): StoredOperation<TEvent> | undefined {
    const row = this.#database.prepare(`
      SELECT fingerprint, event_json
      FROM onyx_operations
      WHERE context = ? AND operation_id = ?
    `).get(context, operationId) as {fingerprint: string; event_json: string} | undefined;
    return row && {fingerprint: row.fingerprint, event: storedEvent<TEvent>(row.event_json, {context, operationId})};
  }

  getOutboxMessage<TEvent>(eventId: string): OutboxMessage<TEvent> | undefined {
    const row = this.#database.prepare(`
      SELECT event_id, context, aggregate_id, organization_id, event_type, event_json,
             aggregate_version, attempt_count, available_at, lease_owner, lease_expires_at,
             delivered_at, dead_lettered_at, last_error
      FROM onyx_outbox
      WHERE event_id = ?
    `).get(eventId) as OutboxRow | undefined;
    return row && toOutboxMessage<TEvent>(row);
  }

  getInboxReceipt(consumerName: string, eventId: string): InboxReceipt | undefined {
    const row = this.#database.prepare(`
      SELECT consumer_name, event_id, fingerprint, attempt_count, received_at,
             lease_owner, lease_expires_at, completed_at, last_error
      FROM onyx_inbox
      WHERE consumer_name = ? AND event_id = ?
    `).get(consumerName, eventId) as InboxRow | undefined;
    return row && toInboxReceipt(row);
  }

  readiness(now: Date): MessagingSnapshot {
    this.#database.prepare("SELECT 1").get();
    const instant = now.toISOString();
    const outbox = this.#database.prepare(`
      SELECT
        COUNT(*) FILTER (WHERE delivered_at IS NULL AND dead_lettered_at IS NULL) AS pending,
        COUNT(*) FILTER (
          WHERE delivered_at IS NULL AND dead_lettered_at IS NULL
            AND available_at <= ? AND (lease_expires_at IS NULL OR lease_expires_at <= ?)
        ) AS ready,
        COUNT(*) FILTER (
          WHERE delivered_at IS NULL AND dead_lettered_at IS NULL AND lease_expires_at > ?
        ) AS leased,
        COUNT(*) FILTER (WHERE delivered_at IS NOT NULL) AS delivered,
        COUNT(*) FILTER (WHERE dead_lettered_at IS NOT NULL) AS dead_lettered,
        MIN(CASE WHEN delivered_at IS NULL AND dead_lettered_at IS NULL THEN available_at END) AS oldest_pending_at
      FROM onyx_outbox
    `).get(instant, instant, instant) as unknown as MessagingOutboxRow;
    const inbox = this.#database.prepare(`
      SELECT
        COUNT(*) FILTER (WHERE completed_at IS NULL AND lease_expires_at > ?) AS processing,
        COUNT(*) FILTER (
          WHERE completed_at IS NULL AND (lease_expires_at IS NULL OR lease_expires_at <= ?)
        ) AS retryable,
        COUNT(*) FILTER (WHERE completed_at IS NOT NULL) AS completed,
        COUNT(*) FILTER (WHERE completed_at IS NULL AND last_error IS NOT NULL) AS failed
      FROM onyx_inbox
    `).get(instant, instant) as unknown as MessagingInboxRow;
    return {
      outbox: {
        pending: outbox.pending,
        ready: outbox.ready,
        leased: outbox.leased,
        delivered: outbox.delivered,
        deadLettered: outbox.dead_lettered,
        ...(outbox.oldest_pending_at !== null ? {oldestPendingAt: outbox.oldest_pending_at} : {}),
      },
      inbox: {
        processing: inbox.processing,
        retryable: inbox.retryable,
        completed: inbox.completed,
        failed: inbox.failed,
      },
    };
  }

  claimInbox(options: ClaimInboxOptions): InboxClaim {
    if (!options.consumerName || !options.eventId || !options.fingerprint || !options.workerId) {
      throw new Error("inbox consumer, event, fingerprint, and worker identifiers are required");
    }
    if (!Number.isInteger(options.leaseDurationMs) || options.leaseDurationMs < 1) {
      throw new Error("inbox lease duration must be a positive integer");
    }
    const now = options.now.toISOString();
    const leaseExpiresAt = new Date(options.now.getTime() + options.leaseDurationMs).toISOString();
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      const existing = this.#database.prepare(`
        SELECT consumer_name, event_id, fingerprint, attempt_count, received_at,
               lease_owner, lease_expires_at, completed_at, last_error
        FROM onyx_inbox
        WHERE consumer_name = ? AND event_id = ?
      `).get(options.consumerName, options.eventId) as InboxRow | undefined;
      if (existing) {
        if (existing.fingerprint !== options.fingerprint) {
          throw new Error("inbox event fingerprint mismatch");
        }
        if (existing.completed_at !== null) {
          this.#database.exec("COMMIT");
          return {status: "duplicate", receipt: toInboxReceipt(existing)};
        }
        if (existing.lease_expires_at !== null && existing.lease_expires_at > now) {
          this.#database.exec("COMMIT");
          return {status: "busy", receipt: toInboxReceipt(existing)};
        }
        this.#database.prepare(`
          UPDATE onyx_inbox
          SET lease_owner = ?, lease_expires_at = ?, attempt_count = attempt_count + 1
          WHERE consumer_name = ? AND event_id = ?
        `).run(options.workerId, leaseExpiresAt, options.consumerName, options.eventId);
        this.#database.exec("COMMIT");
        return {status: "acquired", receipt: toInboxReceipt({
          ...existing,
          attempt_count: existing.attempt_count + 1,
          lease_owner: options.workerId,
          lease_expires_at: leaseExpiresAt,
        })};
      }
      this.#database.prepare(`
        INSERT INTO onyx_inbox(
          consumer_name, event_id, fingerprint, attempt_count, received_at,
          lease_owner, lease_expires_at
        ) VALUES (?, ?, ?, 1, ?, ?, ?)
      `).run(options.consumerName, options.eventId, options.fingerprint, now, options.workerId, leaseExpiresAt);
      this.#database.exec("COMMIT");
      return {
        status: "acquired",
        receipt: {
          consumerName: options.consumerName,
          eventId: options.eventId,
          fingerprint: options.fingerprint,
          attemptCount: 1,
          receivedAt: now,
          leaseOwner: options.workerId,
          leaseExpiresAt,
        },
      };
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
  }

  completeInbox(consumerName: string, eventId: string, workerId: string, completedAt: Date): void {
    const result = this.#database.prepare(`
      UPDATE onyx_inbox
      SET completed_at = ?, lease_owner = NULL, lease_expires_at = NULL, last_error = NULL
      WHERE consumer_name = ? AND event_id = ? AND lease_owner = ? AND completed_at IS NULL
    `).run(completedAt.toISOString(), consumerName, eventId, workerId);
    if (result.changes !== 1) throw new Error("inbox event is not leased by this worker");
  }

  releaseInbox(consumerName: string, eventId: string, workerId: string, error: string): void {
    const result = this.#database.prepare(`
      UPDATE onyx_inbox
      SET lease_owner = NULL, lease_expires_at = NULL, last_error = ?
      WHERE consumer_name = ? AND event_id = ? AND lease_owner = ? AND completed_at IS NULL
    `).run(error.slice(0, 2_048), consumerName, eventId, workerId);
    if (result.changes !== 1) throw new Error("inbox event is not leased by this worker");
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
               aggregate_version, attempt_count, available_at, lease_owner, lease_expires_at,
               delivered_at, dead_lettered_at, last_error
        FROM onyx_outbox
        WHERE delivered_at IS NULL
          AND dead_lettered_at IS NULL
          AND available_at <= ?
          AND (lease_expires_at IS NULL OR lease_expires_at <= ?)
        ORDER BY available_at, context, aggregate_id, aggregate_version, event_id
        LIMIT ?
      `).all(now, now, options.limit) as unknown as OutboxRow[];
      const messages = rows.map((row) => toOutboxMessage<TEvent>(row));
      const claim = this.#database.prepare(`
        UPDATE onyx_outbox
        SET lease_owner = ?, lease_expires_at = ?, attempt_count = attempt_count + 1
        WHERE event_id = ?
      `);
      for (const row of rows) claim.run(options.workerId, leaseExpiresAt, row.event_id);
      this.#database.exec("COMMIT");
      return messages.map((message) => ({
        ...message,
        attemptCount: message.attemptCount + 1,
        leaseOwner: options.workerId,
        leaseExpiresAt,
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
          event_id, context, aggregate_id, aggregate_version, organization_id,
          event_type, event_json, available_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        record.eventId,
        record.context,
        record.aggregateId,
        record.eventVersion,
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
        aggregate_version INTEGER NOT NULL CHECK(aggregate_version >= 1),
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

      CREATE TABLE IF NOT EXISTS onyx_inbox (
        consumer_name TEXT NOT NULL,
        event_id TEXT NOT NULL,
        fingerprint TEXT NOT NULL,
        attempt_count INTEGER NOT NULL DEFAULT 0 CHECK(attempt_count >= 0),
        received_at TEXT NOT NULL,
        lease_owner TEXT,
        lease_expires_at TEXT,
        completed_at TEXT,
        last_error TEXT,
        PRIMARY KEY(consumer_name, event_id),
        CHECK((lease_owner IS NULL) = (lease_expires_at IS NULL))
      );

      CREATE INDEX IF NOT EXISTS onyx_inbox_active
        ON onyx_inbox(consumer_name, completed_at, lease_expires_at);

      INSERT OR IGNORE INTO onyx_schema_migrations(version) VALUES (1);
      INSERT OR IGNORE INTO onyx_schema_migrations(version) VALUES (2);
      INSERT OR IGNORE INTO onyx_schema_migrations(version) VALUES (3);
    `);
    this.#migrateOutboxAggregateVersion();
  }

  #assertNoFutureSchema(): void {
    const migrationTable = this.#database.prepare(`
      SELECT 1 AS present FROM sqlite_schema WHERE type = 'table' AND name = 'onyx_schema_migrations'
    `).get() as {present: number} | undefined;
    if (!migrationTable) return;
    const row = this.#database.prepare("SELECT MAX(version) AS version FROM onyx_schema_migrations").get() as {version: number | null};
    if (row.version !== null && row.version > SQLITE_SCHEMA_VERSION) {
      throw new Error(`database schema version ${row.version} is newer than supported version ${SQLITE_SCHEMA_VERSION}`);
    }
  }

  #migrateOutboxAggregateVersion(): void {
    const columns = this.#database.prepare("PRAGMA table_info(onyx_outbox)").all() as Array<{name: string}>;
    if (!columns.some((column) => column.name === "aggregate_version")) {
      this.#database.exec("BEGIN IMMEDIATE");
      try {
        this.#database.exec("ALTER TABLE onyx_outbox ADD COLUMN aggregate_version INTEGER NOT NULL DEFAULT 0");
        this.#database.exec(`
          UPDATE onyx_outbox
          SET aggregate_version = (
            SELECT aggregate_version FROM onyx_events WHERE onyx_events.event_id = onyx_outbox.event_id
          )
        `);
        this.#database.exec("COMMIT");
      } catch (error) {
        this.#database.exec("ROLLBACK");
        throw error;
      }
    }
    this.#database.exec(`
      CREATE INDEX IF NOT EXISTS onyx_outbox_aggregate_order
        ON onyx_outbox(available_at, context, aggregate_id, aggregate_version, event_id);
      INSERT OR IGNORE INTO onyx_schema_migrations(version) VALUES (4);
    `);
  }
}

interface OutboxRow {
  event_id: string;
  context: string;
  aggregate_id: string;
  aggregate_version: number;
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

interface InboxRow {
  consumer_name: string;
  event_id: string;
  fingerprint: string;
  attempt_count: number;
  received_at: string;
  lease_owner: string | null;
  lease_expires_at: string | null;
  completed_at: string | null;
  last_error: string | null;
}

interface MessagingOutboxRow {
  pending: number;
  ready: number;
  leased: number;
  delivered: number;
  dead_lettered: number;
  oldest_pending_at: string | null;
}

interface MessagingInboxRow {
  processing: number;
  retryable: number;
  completed: number;
  failed: number;
}

function toOutboxMessage<TEvent>(row: OutboxRow): OutboxMessage<TEvent> {
  return {
    eventId: row.event_id,
    context: row.context,
    aggregateId: row.aggregate_id,
    aggregateVersion: row.aggregate_version,
    organizationId: row.organization_id,
    eventType: row.event_type,
    event: storedEvent<TEvent>(row.event_json, {
      context: row.context,
      aggregateId: row.aggregate_id,
      aggregateVersion: row.aggregate_version,
      organizationId: row.organization_id,
      eventId: row.event_id,
      eventType: row.event_type,
    }),
    attemptCount: row.attempt_count,
    availableAt: row.available_at,
    ...(row.lease_owner !== null ? {leaseOwner: row.lease_owner} : {}),
    ...(row.lease_expires_at !== null ? {leaseExpiresAt: row.lease_expires_at} : {}),
    ...(row.delivered_at !== null ? {deliveredAt: row.delivered_at} : {}),
    ...(row.dead_lettered_at !== null ? {deadLetteredAt: row.dead_lettered_at} : {}),
    ...(row.last_error !== null ? {lastError: row.last_error} : {}),
  };
}

interface StoredEventExpectation {
  context: string;
  aggregateId?: string;
  aggregateVersion?: number;
  organizationId?: string;
  eventId?: string;
  eventType?: string;
  operationId?: string;
}

export const EXECUTABLE_EVENT_PROFILES: Readonly<Record<string, {aggregateType: string; eventTypes: ReadonlySet<string>}>> = {
  mission: {
    aggregateType: "Mission",
    eventTypes: new Set([
      "MissionCreated", "MissionBlueprintRevisionCreated", "MissionBlueprintSubmitted", "MissionActivated",
      "MissionPaused", "MissionResumed", "MissionOperationallyHalted", "MissionRestarted", "MissionClosed", "MissionCancelled", "MissionArchived",
    ]),
  },
  work: {aggregateType: "Task", eventTypes: new Set(["TaskCreated","TaskOwnerAssigned","TaskPriorityChanged","TaskDependencyAdded","TaskStarted","TaskPaused","TaskBlocked","TaskCompletionSubmitted","TaskApproved","TaskReopened","TaskClosed","TaskCancelled"])},
  timeline: {aggregateType: "Timeline", eventTypes: new Set(["TimelineCreated","DeadlineChanged","DeadlineMoved","DeadlineReached","MilestoneAdded","CriticalMarkerDefined","CriticalMarkerReached","PenaltyZoneActivated","ScheduleExceptionRaised","TimelineArchived"])},
  "reporting-evidence": {aggregateType: "Report", eventTypes: new Set(["ReportCreated","EvidenceAdded","EvidenceVerified","EvidenceRejected","ReportSubmitted","ReportApproved","ReportRejected","ReportArchived"])},
  organization: {aggregateType: "Organization", eventTypes: new Set(["OrganizationCreated","WorkspaceCreated","DepartmentCreated","TeamCreated","GroupCreated","TeamMoved","DepartmentArchived","OrganizationArchived"])},
  "identity-authority": {aggregateType: "User", eventTypes: new Set(["UserCreated","RoleAssigned","RoleRevoked","DeviceRegistered","DeviceRevoked","AuthorityDelegated","DelegationRevoked","UserDisabled","UserEnabled"])},
  context: {aggregateType: "ContextLink", eventTypes: new Set(["ContextLinkCreated","ContextMetadataUpdated","ContextStrengthChanged","ContextLinkArchived","ContextLinkRestored"])},
  meeting: {aggregateType: "Meeting", eventTypes: new Set(["MeetingCreated","ParticipantInvited","ParticipantRemoved","MeetingStarted","DecisionRecorded","ActionItemProposed","MeetingEnded","MeetingCancelled"])},
  communication: {aggregateType: "Conversation", eventTypes: new Set(["ConversationCreated","ConversationMemberAdded","MessagePosted","MessageEdited","MessageRedacted","ReactionAdded","ReactionRemoved","ConversationArchived"])},
  file: {aggregateType: "FileAsset", eventTypes: new Set(["FileAssetCreated","UploadStarted","ChunkAccepted","UploadFinalized","FileVersionCreated","FileAccessGranted","FileAccessRevoked","FileQuarantined","FileArchived"])},
  approval: {aggregateType: "Approval", eventTypes: new Set(["ApprovalCreated","ApproverAssigned","ApprovalGranted","ApprovalRejected","ChangesRequested","ApprovalDelegated","ApprovalEscalated","ApprovalCancelled","ApprovalReversed","ApprovalReopened"])},
  capacity: {aggregateType: "CapacityProfile", eventTypes: new Set(["CapacityProfileCreated","AvailabilityUpdated","WorkloadAllocated","CapacitySnapshotCaptured","CapacityRecalculated","CapacityProfileArchived"])},
  forecasting: {aggregateType: "Forecast", eventTypes: new Set(["ForecastGenerated","ScenarioCreated","ForecastRecalculated","ForecastPublished","ForecastArchived"])},
  automation: {aggregateType: "AutomationRule", eventTypes: new Set(["AutomationRuleCreated","AutomationRuleEnabled","AutomationRuleDisabled","AutomationRuleTriggered","AutomationActionExecuted","AutomationExecutionFailed","AutomationExecutionCompensated","AutomationRuleArchived"])},
  notification: {aggregateType: "Notification", eventTypes: new Set(["NotificationCreated","RecipientsResolved","NotificationSent","NotificationDeliveryFailed","NotificationEscalated","NotificationAcknowledged","NotificationArchived"])},
  synchronization: {aggregateType: "Synchronization", eventTypes: new Set(["SynchronizationStarted","OperationBatchOffered","OperationBatchAccepted","OperationBatchMerged","ConflictDetected","ConflictResolved","ConflictEscalated","SynchronizationAcknowledged","SynchronizationClosed"])},
  audit: {aggregateType: "AuditPartition", eventTypes: new Set(["AuditEntryAppended","AuditPartitionSealed","AuditExportCreated","AuditIntegrityVerified","AuditPartitionArchived"])},
  policy: {aggregateType: "Policy", eventTypes: new Set(["PolicyCreated","PolicyVersionCreated","PolicyVersionPublished","PolicyEvaluated","PolicyViolationDetected","LegalHoldApplied","LegalHoldReleased","PolicyRetired","RateLimitPolicyDefined","QuotaThresholdReached","QuotaExceeded","RateLimitTriggered"])},
};

function storedEvent<TEvent>(json: string, expected: StoredEventExpectation): TEvent {
  let value: unknown;
  try {
    value = JSON.parse(json) as unknown;
    const profile = EXECUTABLE_EVENT_PROFILES[expected.context];
    if (!profile) return value as TEvent;
    const event = value as Record<string, any>;
    if (!profile.eventTypes.has(event?.event_type)) throw new Error("stored event type is not executable for its context");
    validateEventEnvelope(event, event.event_type, profile.aggregateType);
    if (expected.eventId !== undefined && event.event_id !== expected.eventId) throw new Error("stored event id does not match its row");
    if (expected.eventType !== undefined && event.event_type !== expected.eventType) throw new Error("stored event type does not match its row");
    if (expected.organizationId !== undefined && event.organization_id !== expected.organizationId) {
      throw new Error("stored event organization does not match its row");
    }
    if (expected.aggregateId !== undefined && event.aggregate?.object_id !== expected.aggregateId) {
      throw new Error("stored event aggregate does not match its row");
    }
    if (expected.aggregateVersion !== undefined && event.aggregate_version !== expected.aggregateVersion) {
      throw new Error("stored event version does not match its row");
    }
    if (expected.operationId !== undefined && event.operation_id !== expected.operationId) {
      throw new Error("stored event operation does not match its row");
    }
    return value as TEvent;
  } catch (cause) {
    throw new Error("stored event failed integrity validation", {cause});
  }
}

function toInboxReceipt(row: InboxRow): InboxReceipt {
  return {
    consumerName: row.consumer_name,
    eventId: row.event_id,
    fingerprint: row.fingerprint,
    attemptCount: row.attempt_count,
    receivedAt: row.received_at,
    ...(row.lease_owner !== null ? {leaseOwner: row.lease_owner} : {}),
    ...(row.lease_expires_at !== null ? {leaseExpiresAt: row.lease_expires_at} : {}),
    ...(row.completed_at !== null ? {completedAt: row.completed_at} : {}),
    ...(row.last_error !== null ? {lastError: row.last_error} : {}),
  };
}
