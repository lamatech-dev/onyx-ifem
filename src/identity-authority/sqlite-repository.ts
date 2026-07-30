import { SqliteDatabase } from "../infrastructure/sqlite/database.ts";
import type { IdentityOperationRecord, IdentityRepository } from "./repository.ts";
import type { IdentityEvent, UserIdentity } from "./types.ts";
const CONTEXT = "identity-authority";
export class SqliteIdentityRepository implements IdentityRepository {
  readonly database: SqliteDatabase;
  constructor(database: SqliteDatabase) { this.database = database; }
  async find(id: string) { return this.database.getState<UserIdentity>(CONTEXT, id); }
  async list(organizationId: string, afterId: string | undefined, limit: number) { return this.database.listStates<UserIdentity>(CONTEXT, organizationId, afterId, limit); }
  async history(id: string, afterVersion = 0, limit = 100) { return this.database.getEvents<IdentityEvent>(CONTEXT, id, afterVersion, limit); }
  async findOperation(id: string) { return this.database.getOperation<IdentityEvent>(CONTEXT, id); }
  async commit(state: UserIdentity, event: IdentityEvent, operationId: string, record: IdentityOperationRecord, create: boolean) { this.database.commit({context: CONTEXT, aggregateId: state.userId, organizationId: state.organizationId, version: state.version, state, eventId: event.event_id, eventVersion: event.aggregate_version, event, operationId, fingerprint: record.fingerprint, create}); }
}
