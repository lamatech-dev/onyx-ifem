import { SqliteDatabase } from "../infrastructure/sqlite/database.ts";
import type { ReportingOperationRecord, ReportingRepository } from "./repository.ts";
import type { Report, ReportingEvent } from "./types.ts";

const CONTEXT = "reporting-evidence";

export class SqliteReportingRepository implements ReportingRepository {
  readonly #database: SqliteDatabase;

  constructor(database: SqliteDatabase) {
    this.#database = database;
  }

  async find(reportId: string): Promise<Report | undefined> {
    return this.#database.getState<Report>(CONTEXT, reportId);
  }

  async list(organizationId: string, afterId: string | undefined, limit: number): Promise<Report[]> {
    return this.#database.listStates<Report>(CONTEXT, organizationId, afterId, limit);
  }

  async history(reportId: string, afterVersion = 0, limit = 100): Promise<ReportingEvent[]> {
    return this.#database.getEvents<ReportingEvent>(CONTEXT, reportId, afterVersion, limit);
  }

  async findOperation(operationId: string): Promise<ReportingOperationRecord | undefined> {
    return this.#database.getOperation<ReportingEvent>(CONTEXT, operationId);
  }

  async commit(report: Report, event: ReportingEvent, operationId: string, record: ReportingOperationRecord, create: boolean): Promise<void> {
    this.#database.commit({
      context: CONTEXT,
      aggregateId: report.reportId,
      organizationId: report.organizationId,
      version: report.version,
      state: report,
      eventId: event.event_id,
      eventVersion: event.aggregate_version,
      event,
      operationId,
      fingerprint: record.fingerprint,
      create,
    });
  }
}
