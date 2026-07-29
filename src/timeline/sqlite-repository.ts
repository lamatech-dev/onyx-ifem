import { SqliteDatabase } from "../infrastructure/sqlite/database.ts";
import type { TimelineOperationRecord, TimelineRepository } from "./repository.ts";
import type { Timeline, TimelineCreatedEvent } from "./types.ts";

const CONTEXT = "timeline";

export class SqliteTimelineRepository implements TimelineRepository {
  readonly #database: SqliteDatabase;

  constructor(database: SqliteDatabase) {
    this.#database = database;
  }

  async find(timelineId: string): Promise<Timeline | undefined> {
    return this.#database.getState<Timeline>(CONTEXT, timelineId);
  }

  async list(organizationId: string, afterId: string | undefined, limit: number): Promise<Timeline[]> {
    return this.#database.listStates<Timeline>(CONTEXT, organizationId, afterId, limit);
  }

  async history(timelineId: string, afterVersion = 0, limit = 100): Promise<TimelineCreatedEvent[]> {
    return this.#database.getEvents<TimelineCreatedEvent>(CONTEXT, timelineId, afterVersion, limit);
  }

  async findOperation(operationId: string): Promise<TimelineOperationRecord | undefined> {
    return this.#database.getOperation<TimelineCreatedEvent>(CONTEXT, operationId);
  }

  async commit(timeline: Timeline, event: TimelineCreatedEvent, operationId: string, record: TimelineOperationRecord): Promise<void> {
    this.#database.commit({
      context: CONTEXT,
      aggregateId: timeline.timelineId,
      organizationId: timeline.organizationId,
      version: timeline.version,
      state: timeline,
      eventId: event.event_id,
      eventVersion: event.aggregate_version,
      event,
      operationId,
      fingerprint: record.fingerprint,
      create: true,
    });
  }
}
