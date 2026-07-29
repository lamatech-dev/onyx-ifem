import { exactKeys, fail, object, uuid, validateCommandEnvelope, validateDomainObjectRef } from "../contracts/validation.ts";
import type { CreateReportCommand } from "./types.ts";

const PAYLOAD_KEYS = new Set(["report_id", "report_type", "subject_ref", "author_id", "title"]);

export function validateCreateReportCommand(value: unknown): asserts value is CreateReportCommand {
  const command = validateCommandEnvelope(value, "CreateReport", "Report");
  const target = command.target;

  const payload = object(command.payload, "payload");
  exactKeys(payload, PAYLOAD_KEYS, "payload");
  uuid(payload.report_id, "payload.report_id");
  uuid(payload.author_id, "payload.author_id");
  if (typeof payload.report_type !== "string") fail("payload.report_type must be a string");
  if (typeof payload.title !== "string" || payload.title.length < 1) fail("payload.title must not be empty");
  validateDomainObjectRef(payload.subject_ref, "payload.subject_ref");
  if (target.object_id !== payload.report_id) fail("target object must match payload report_id");
}
