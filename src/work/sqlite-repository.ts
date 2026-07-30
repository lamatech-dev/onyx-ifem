import { SqliteDatabase } from "../infrastructure/sqlite/database.ts";
import type { WorkOperationRecord, WorkRepository } from "./repository.ts";
import type { Task, WorkEvent } from "./types.ts";

const CONTEXT = "work";

export class SqliteWorkRepository implements WorkRepository {
  readonly #database: SqliteDatabase;

  constructor(database: SqliteDatabase) {
    this.#database = database;
  }

  async find(taskId: string): Promise<Task | undefined> {
    return this.#database.getState<Task>(CONTEXT, taskId);
  }

  async list(organizationId: string, afterId: string | undefined, limit: number): Promise<Task[]> {
    return this.#database.listStates<Task>(CONTEXT, organizationId, afterId, limit);
  }

  async history(taskId: string, afterVersion = 0, limit = 100): Promise<WorkEvent[]> {
    return this.#database.getEvents<WorkEvent>(CONTEXT, taskId, afterVersion, limit);
  }

  async findOperation(operationId: string): Promise<WorkOperationRecord | undefined> {
    return this.#database.getOperation<WorkEvent>(CONTEXT, operationId);
  }

  async commit(task: Task, event: WorkEvent, operationId: string, record: WorkOperationRecord, create: boolean): Promise<void> {
    this.#database.commit({
      context: CONTEXT,
      aggregateId: task.taskId,
      organizationId: task.organizationId,
      version: task.version,
      state: task,
      eventId: event.event_id,
      eventVersion: event.aggregate_version,
      event,
      operationId,
      fingerprint: record.fingerprint,
      create,
    });
  }
}
