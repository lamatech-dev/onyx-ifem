import type { Report, ReportingEvent, ReportView } from "./types.ts";

export interface ReportingOperationRecord {
  fingerprint: string;
  event: ReportingEvent;
}

export interface ReportingRepository {
  find(reportId: string): Promise<Report | undefined>;
  list(organizationId: string, afterId: string | undefined, limit: number): Promise<Report[]>;
  history(reportId: string, afterVersion?: number, limit?: number): Promise<ReportingEvent[]>;
  findOperation(operationId: string): Promise<ReportingOperationRecord | undefined>;
  commit(report: Report, event: ReportingEvent, operationId: string, record: ReportingOperationRecord, create: boolean): Promise<void>;
}

export class InMemoryReportingRepository implements ReportingRepository {
  readonly #reports = new Map<string, Report>();
  readonly #events = new Map<string, ReportingEvent[]>();
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

  async history(reportId: string, afterVersion = 0, limit = 100): Promise<ReportingEvent[]> {
    return (this.#events.get(reportId) ?? [])
      .filter((event) => event.aggregate_version > afterVersion)
      .slice(0, limit)
      .map((event) => structuredClone(event));
  }

  async findOperation(operationId: string): Promise<ReportingOperationRecord | undefined> {
    const record = this.#operations.get(operationId);
    return record && structuredClone(record);
  }

  async commit(report: Report, event: ReportingEvent, operationId: string, record: ReportingOperationRecord, create: boolean): Promise<void> {
    if (create === this.#reports.has(report.reportId)) throw new Error(create ? "report already exists during commit" : "report does not exist during commit");
    if (this.#operations.has(operationId)) throw new Error("operation already exists during commit");
    this.#reports.set(report.reportId, structuredClone(report));
    this.#events.set(report.reportId, [...(this.#events.get(report.reportId) ?? []), structuredClone(event)]);
    this.#operations.set(operationId, structuredClone(record));
  }
}

export function toReportView(report: Report): ReportView {
  report.status ??= "DRAFT"; report.lifecycleEpoch ??= 0; report.authorityEpoch ??= 0; report.evidence ??= {};
  return {
    report_id: report.reportId,
    organization_id: report.organizationId,
    report_type: report.reportType,
    subject_ref: structuredClone(report.subjectRef),
    author_id: report.authorId,
    title: report.title,
    version: report.version,
    status: report.status,
    lifecycle_epoch: report.lifecycleEpoch,
    authority_epoch: report.authorityEpoch,
    evidence: Object.fromEntries(Object.entries(report.evidence).map(([id, item]) => [id, {evidence_id: item.evidenceId, evidence_type: item.evidenceType, uri: item.uri, content_hash: item.contentHash, ...(item.description !== undefined ? {description: item.description} : {}), status: item.status}])),
  };
}
