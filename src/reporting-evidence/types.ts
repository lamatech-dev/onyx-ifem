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

export interface AddEvidencePayload { report_id: UuidV7; evidence_id: UuidV7; evidence_type: string; uri: string; content_hash: string; description?: string }
export interface VerifyEvidencePayload { report_id: UuidV7; evidence_id: UuidV7; verification_note: string }
export interface RejectEvidencePayload { report_id: UuidV7; evidence_id: UuidV7; reason_code: string; reason: string }
export interface SubmitReportPayload { report_id: UuidV7; submission_note: string }
export interface ApproveReportPayload { report_id: UuidV7; approval_note: string }
export interface RejectReportPayload { report_id: UuidV7; reason_code: string; reason: string }
export interface ArchiveReportPayload { report_id: UuidV7; retention_policy_id: UuidV7 }

export type ReportingCommand = CreateReportCommand | CommandEnvelope<"AddEvidence", AddEvidencePayload> |
  CommandEnvelope<"VerifyEvidence", VerifyEvidencePayload> | CommandEnvelope<"RejectEvidence", RejectEvidencePayload> |
  CommandEnvelope<"SubmitReport", SubmitReportPayload> | CommandEnvelope<"ApproveReport", ApproveReportPayload> |
  CommandEnvelope<"RejectReport", RejectReportPayload> | CommandEnvelope<"ArchiveReport", ArchiveReportPayload>;

export type ReportingEvent = ReportCreatedEvent |
  EventEnvelope<"EvidenceAdded", AddEvidencePayload> |
  EventEnvelope<"EvidenceVerified", {evidence_id: UuidV7; verification_status: "VERIFIED"}> |
  EventEnvelope<"EvidenceRejected", {evidence_id: UuidV7; verification_status: "REJECTED"}> |
  EventEnvelope<"ReportSubmitted", {new_status: "SUBMITTED"}> |
  EventEnvelope<"ReportApproved", {new_status: "APPROVED"}> |
  EventEnvelope<"ReportRejected", {new_status: "REJECTED"}> |
  EventEnvelope<"ReportArchived", {new_status: "ARCHIVED"}>;

export interface EvidenceRecord { evidenceId: UuidV7; evidenceType: string; uri: string; contentHash: string; description?: string; status: "ADDED" | "VERIFIED" | "REJECTED" }

export interface Report {
  reportId: UuidV7;
  organizationId: UuidV7;
  reportType: string;
  subjectRef: DomainObjectRef;
  authorId: UuidV7;
  title: string;
  version: number;
  status: "DRAFT" | "SUBMITTED" | "APPROVED" | "REJECTED" | "ARCHIVED";
  lifecycleEpoch: number;
  authorityEpoch: number;
  evidence: Record<UuidV7, EvidenceRecord>;
}

export interface ReportView {
  report_id: UuidV7;
  organization_id: UuidV7;
  report_type: string;
  subject_ref: DomainObjectRef;
  author_id: UuidV7;
  title: string;
  version: number;
  status: "DRAFT" | "SUBMITTED" | "APPROVED" | "REJECTED" | "ARCHIVED";
  lifecycle_epoch: number;
  authority_epoch: number;
  evidence: Record<UuidV7, {evidence_id: UuidV7; evidence_type: string; uri: string; content_hash: string; description?: string; status: "ADDED" | "VERIFIED" | "REJECTED"}>;
}
