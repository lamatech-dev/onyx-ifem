import { SqliteDatabase } from "../infrastructure/sqlite/database.ts";
import type { MissionRepository, OperationRecord } from "./repository.ts";
import type { Mission, MissionEvent } from "./types.ts";

const CONTEXT = "mission";

export class SqliteMissionRepository implements MissionRepository {
  readonly #database: SqliteDatabase;

  constructor(database: SqliteDatabase) {
    this.#database = database;
  }

  async find(missionId: string): Promise<Mission | undefined> {
    return this.#database.getState<Mission>(CONTEXT, missionId);
  }

  async list(organizationId: string, afterId: string | undefined, limit: number): Promise<Mission[]> {
    return this.#database.listStates<Mission>(CONTEXT, organizationId, afterId, limit);
  }

  async history(missionId: string, afterVersion = 0, limit = 100): Promise<MissionEvent[]> {
    return this.#database.getEvents<MissionEvent>(CONTEXT, missionId, afterVersion, limit);
  }

  async findOperation(operationId: string): Promise<OperationRecord | undefined> {
    return this.#database.getOperation<MissionEvent>(CONTEXT, operationId);
  }

  async commit(mission: Mission, event: MissionEvent, operationId: string, record: OperationRecord, create: boolean): Promise<void> {
    this.#database.commit({
      context: CONTEXT,
      aggregateId: mission.missionId,
      organizationId: mission.organizationId,
      version: mission.version,
      state: mission,
      eventId: event.event_id,
      eventVersion: event.aggregate_version,
      event,
      operationId,
      fingerprint: record.fingerprint,
      create,
    });
  }
}
