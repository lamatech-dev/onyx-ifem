import { exactKeys, fail, object, text, uuid, validateCommandEnvelope, validateDomainObjectRef } from "../contracts/validation.ts";
import type { CreateTimelineCommand, TimelineCommand } from "./types.ts";

function envelope(value: unknown, type: TimelineCommand["command_type"]): Record<string, any> {
  return validateCommandEnvelope(value, type, "Timeline");
}

function payload(command: Record<string, any>, keys: string[]): Record<string, any> {
  const value = object(command.payload, "payload");
  exactKeys(value, keys, "payload");
  uuid(value.timeline_id, "payload.timeline_id");
  if (command.target.object_id !== value.timeline_id) fail("target object must match payload timeline_id");
  return value;
}

function instant(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(value) || !Number.isFinite(Date.parse(value))) fail(`${field} must be a canonical UTC instant`);
}

export function validateCreateTimelineCommand(value: unknown): asserts value is CreateTimelineCommand {
  const command = envelope(value, "CreateTimeline");
  const body = payload(command, ["timeline_id", "subject_ref", "timezone"]);
  text(body.timezone, "payload.timezone", 100);
  validateDomainObjectRef(body.subject_ref, "payload.subject_ref");
}

export function validateTimelineCommand(value: unknown): asserts value is TimelineCommand {
  const type = (value as {command_type?: string})?.command_type as TimelineCommand["command_type"];
  if (type === "CreateTimeline") { validateCreateTimelineCommand(value); return; }
  const command = envelope(value, type);
  let body: Record<string, any>;
  switch (type) {
    case "SetDeadline": body = payload(command, ["timeline_id", "deadline_id", "deadline_at", "label"]); uuid(body.deadline_id, "payload.deadline_id"); instant(body.deadline_at, "payload.deadline_at"); text(body.label, "payload.label", 200); return;
    case "MoveDeadline": body = payload(command, ["timeline_id", "deadline_id", "new_deadline_at", "reason"]); uuid(body.deadline_id, "payload.deadline_id"); instant(body.new_deadline_at, "payload.new_deadline_at"); text(body.reason, "payload.reason", 2_000); return;
    case "AddMilestone": body = payload(command, ["timeline_id", "milestone_id", "title", "due_at"]); uuid(body.milestone_id, "payload.milestone_id"); text(body.title, "payload.title", 200); instant(body.due_at, "payload.due_at"); return;
    case "DefineCriticalMarker": body = payload(command, ["timeline_id", "marker_id", "label", "trigger_at"]); uuid(body.marker_id, "payload.marker_id"); text(body.label, "payload.label", 200); instant(body.trigger_at, "payload.trigger_at"); return;
    case "ActivatePenaltyZone": body = payload(command, ["timeline_id", "penalty_zone_id", "starts_at", "reason"]); uuid(body.penalty_zone_id, "payload.penalty_zone_id"); instant(body.starts_at, "payload.starts_at"); text(body.reason, "payload.reason", 2_000); return;
    case "ResolveScheduleException": body = payload(command, ["timeline_id", "exception_id", "resolution_note"]); uuid(body.exception_id, "payload.exception_id"); text(body.resolution_note, "payload.resolution_note", 4_000); return;
    case "ArchiveTimeline": body = payload(command, ["timeline_id", "retention_policy_id"]); uuid(body.retention_policy_id, "payload.retention_policy_id"); return;
    default: fail("command is not implemented");
  }
}
