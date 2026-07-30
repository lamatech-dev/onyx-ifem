import { SqliteDatabase } from "../infrastructure/sqlite/database.ts";
import type { OrganizationOperationRecord, OrganizationRepository } from "./repository.ts";
import type { OrganizationEvent, OrganizationStructure } from "./types.ts";
const CONTEXT = "organization";
export class SqliteOrganizationRepository implements OrganizationRepository {
  readonly database: SqliteDatabase;
  constructor(database: SqliteDatabase) { this.database = database; }
  async find(id: string) { return this.database.getState<OrganizationStructure>(CONTEXT, id); }
  async list(organizationId: string, afterId: string | undefined, limit: number) { return this.database.listStates<OrganizationStructure>(CONTEXT, organizationId, afterId, limit); }
  async history(id: string, afterVersion = 0, limit = 100) { return this.database.getEvents<OrganizationEvent>(CONTEXT, id, afterVersion, limit); }
  async findOperation(id: string) { return this.database.getOperation<OrganizationEvent>(CONTEXT, id); }
  async commit(state: OrganizationStructure, event: OrganizationEvent, operationId: string, record: OrganizationOperationRecord, create: boolean) { this.database.commit({context: CONTEXT, aggregateId: state.organizationId, organizationId: state.organizationId, version: state.version, state, eventId: event.event_id, eventVersion: event.aggregate_version, event, operationId, fingerprint: record.fingerprint, create}); }
}
