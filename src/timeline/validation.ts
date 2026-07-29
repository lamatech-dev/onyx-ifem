import { exactKeys, fail, object, uuid, validateCommandEnvelope, validateDomainObjectRef } from "../contracts/validation.ts";
import type { CreateTimelineCommand } from "./types.ts";

const PAYLOAD_KEYS = new Set(["timeline_id", "subject_ref", "timezone"]);

export function validateCreateTimelineCommand(value: unknown): asserts value is CreateTimelineCommand {
  const command = validateCommandEnvelope(value, "CreateTimeline", "Timeline");
  const target = command.target;

  const payload = object(command.payload, "payload");
  exactKeys(payload, PAYLOAD_KEYS, "payload");
  uuid(payload.timeline_id, "payload.timeline_id");
  if (typeof payload.timezone !== "string" || payload.timezone.length < 1) fail("payload.timezone must not be empty");
  validateDomainObjectRef(payload.subject_ref, "payload.subject_ref");
  if (target.object_id !== payload.timeline_id) fail("target object must match payload timeline_id");
}
