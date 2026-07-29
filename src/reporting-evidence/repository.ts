import type { Report, ReportCreatedEvent, ReportView } from "./types.ts";

export interface ReportingOperationRecord {
  fingerprint: string;
  event: ReportCreatedEvent;
}

export interface ReportingRepository {
  find(reportId: string): Promise<Report | undefined>;
  list(organizationId: string, afterId: string | undefined, limit: number): Promise<Report[]>;
  history(reportId: string, afterVersion?: number, limit?: number): Promise<ReportCreatedEvent[]>;
  findOperation(operationId: string): Promise<ReportingOperationRecord | undefined>;
  commit(report: Report, event: ReportCreatedEvent, operationId: string, record: ReportingOperationRecord): Promise<void>;
}

export class InMemoryReportingRepository implements ReportingRepository {
  readonly #reports = new Map<string, Report>();
  readonly #events = new Map<string, ReportCreatedEvent[]>();
  readonly #operations = new Map<string, ReportingOperationRecord>();

  async find(reportId: string): Promise<Report | undefined> {
    const report = this.#reports.get(reportId);
    return report && structuredClone(report);
  }

  async list(organizationId: string, afterId: string | undefined, limit: number): Promise<Report[]> {
    return [...this.#reports.values()]
      .filter((report) => report.organizationId === organizationId && (afterId === undefined || report.reportId > afterId))
      .sort((left, right) => left.reportId.localeCompare(right.reportId))
      .slice(0, limit)
      .map((report) => structuredClone(report));
  }

  async history(reportId: string, afterVersion = 0, limit = 100): Promise<ReportCreatedEvent[]> {
    return (this.#events.get(reportId) ?? [])
      .filter((event) => event.aggregate_version > afterVersion)
      .slice(0, limit)
      .map((event) => structuredClone(event));
  }

  async findOperation(operationId: string): Promise<ReportingOperationRecord | undefined> {
    const record = this.#operations.get(operationId);
    return record && structuredClone(record);
  }

  async commit(report: Report, event: ReportCreatedEvent, operationId: string, record: ReportingOperationRecord): Promise<void> {
    if (this.#reports.has(report.reportId)) throw new Error("report already exists during commit");
    if (this.#operations.has(operationId)) throw new Error("operation already exists during commit");
    this.#reports.set(report.reportId, structuredClone(report));
    this.#events.set(report.reportId, [structuredClone(event)]);
    this.#operations.set(operationId, structuredClone(record));
  }
}

export function toReportView(report: Report): ReportView {
  return {
    report_id: report.reportId,
    organization_id: report.organizationId,
    report_type: report.reportType,
    subject_ref: structuredClone(report.subjectRef),
    author_id: report.authorId,
    title: report.title,
    version: report.version,
  };
}
