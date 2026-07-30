import { exactKeys, fail, object, text, uuid, validateCommandEnvelope, validateDomainObjectRef } from "../contracts/validation.ts";
import type { CreateReportCommand, ReportingCommand } from "./types.ts";

function envelope(value: unknown, type: ReportingCommand["command_type"]): Record<string, any> { return validateCommandEnvelope(value, type, "Report"); }
function payload(command: Record<string, any>, keys: string[]): Record<string, any> { const body = object(command.payload, "payload"); exactKeys(body, keys, "payload"); uuid(body.report_id, "payload.report_id"); if (command.target.object_id !== body.report_id) fail("target object must match payload report_id"); return body; }

export function validateCreateReportCommand(value: unknown): asserts value is CreateReportCommand {
  const command = envelope(value, "CreateReport"), body = payload(command, ["report_id", "report_type", "subject_ref", "author_id", "title"]);
  uuid(body.author_id, "payload.author_id"); text(body.report_type, "payload.report_type", 100); text(body.title, "payload.title", 200); validateDomainObjectRef(body.subject_ref, "payload.subject_ref");
}

export function validateReportingCommand(value: unknown): asserts value is ReportingCommand {
  const type = (value as {command_type?: string})?.command_type as ReportingCommand["command_type"];
  if (type === "CreateReport") { validateCreateReportCommand(value); return; }
  const command = envelope(value, type); let body: Record<string, any>;
  switch (type) {
    case "AddEvidence": body = payload(command, ["report_id", "evidence_id", "evidence_type", "uri", "content_hash", "description"]); uuid(body.evidence_id, "payload.evidence_id"); text(body.evidence_type, "payload.evidence_type", 100); text(body.uri, "payload.uri", 2_000); if (!/^[0-9a-f]{64}$/.test(body.content_hash)) fail("payload.content_hash must be a lowercase SHA-256 digest"); if (body.description !== undefined) text(body.description, "payload.description", 4_000); return;
    case "VerifyEvidence": body = payload(command, ["report_id", "evidence_id", "verification_note"]); uuid(body.evidence_id, "payload.evidence_id"); text(body.verification_note, "payload.verification_note", 4_000); return;
    case "RejectEvidence": body = payload(command, ["report_id", "evidence_id", "reason_code", "reason"]); uuid(body.evidence_id, "payload.evidence_id"); text(body.reason_code, "payload.reason_code", 200); text(body.reason, "payload.reason", 4_000); return;
    case "SubmitReport": body = payload(command, ["report_id", "submission_note"]); text(body.submission_note, "payload.submission_note", 4_000); return;
    case "ApproveReport": body = payload(command, ["report_id", "approval_note"]); text(body.approval_note, "payload.approval_note", 4_000); return;
    case "RejectReport": body = payload(command, ["report_id", "reason_code", "reason"]); text(body.reason_code, "payload.reason_code", 200); text(body.reason, "payload.reason", 4_000); return;
    case "ArchiveReport": body = payload(command, ["report_id", "retention_policy_id"]); uuid(body.retention_policy_id, "payload.retention_policy_id"); return;
    default: fail("command is not implemented");
  }
}
