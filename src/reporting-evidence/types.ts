import type { CommandEnvelope, DomainObjectRef, EventEnvelope, UuidV7 } from "../contracts/envelopes.ts";

export interface CreateReportPayload {
  report_id: UuidV7;
  report_type: string;
  subject_ref: DomainObjectRef;
  author_id: UuidV7;
  title: string;
}

export type CreateReportCommand = CommandEnvelope<"CreateReport", CreateReportPayload>;
export type ReportCreatedEvent = EventEnvelope<"ReportCreated", CreateReportPayload>;

export interface Report {
  reportId: UuidV7;
  organizationId: UuidV7;
  reportType: string;
  subjectRef: DomainObjectRef;
  authorId: UuidV7;
  title: string;
  version: number;
}

export interface ReportView {
  report_id: UuidV7;
  organization_id: UuidV7;
  report_type: string;
  subject_ref: DomainObjectRef;
  author_id: UuidV7;
  title: string;
  version: number;
}
