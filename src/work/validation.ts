import { exactKeys, fail, object, text, uuid, validateCommandEnvelope } from "../contracts/validation.ts";
import type { CreateTaskCommand, WorkCommand } from "./types.ts";

function envelope(value: unknown, type: WorkCommand["command_type"]): Record<string, any> {
  return validateCommandEnvelope(value, type, "Task");
}

function taskPayload(command: Record<string, any>, keys: string[]): Record<string, any> {
  const payload = object(command.payload, "payload");
  exactKeys(payload, keys, "payload");
  uuid(payload.task_id, "payload.task_id");
  if (command.target.object_id !== payload.task_id) fail("target object must match payload task_id");
  return payload;
}

export function validateCreateTaskCommand(value: unknown): asserts value is CreateTaskCommand {
  const command = envelope(value, "CreateTask");
  const payload = taskPayload(command, ["task_id", "mission_id", "title", "description", "owner_id", "priority", "due_date_ref", "estimate"]);
  uuid(payload.mission_id, "payload.mission_id"); uuid(payload.owner_id, "payload.owner_id");
  text(payload.title, "payload.title", 200);
  if (typeof payload.description !== "string" || payload.description.length > 8_000) fail("payload.description must contain at most 8000 characters");
  text(payload.priority, "payload.priority", 100);
  if (payload.due_date_ref !== undefined) object(payload.due_date_ref, "payload.due_date_ref");
  if (payload.estimate !== undefined) object(payload.estimate, "payload.estimate");
}

export function validateWorkCommand(value: unknown): asserts value is WorkCommand {
  const type = (value as {command_type?: string})?.command_type as WorkCommand["command_type"];
  if (type === "CreateTask") { validateCreateTaskCommand(value); return; }
  const command = envelope(value, type);
  let payload: Record<string, any>;
  switch (type) {
    case "AssignOwner":
      payload = taskPayload(command, ["task_id", "owner_id", "assignment_note"]); uuid(payload.owner_id, "payload.owner_id"); if (payload.assignment_note !== undefined) text(payload.assignment_note, "payload.assignment_note", 2_000); return;
    case "ChangePriority":
      payload = taskPayload(command, ["task_id", "priority", "reason"]); text(payload.priority, "payload.priority", 100); if (payload.reason !== undefined) text(payload.reason, "payload.reason", 2_000); return;
    case "AddDependency":
      payload = taskPayload(command, ["task_id", "dependency_task_id"]); uuid(payload.dependency_task_id, "payload.dependency_task_id"); return;
    case "StartTask":
      payload = taskPayload(command, ["task_id", "start_note"]); if (payload.start_note !== undefined) text(payload.start_note, "payload.start_note", 2_000); return;
    case "PauseTask":
      payload = taskPayload(command, ["task_id", "reason_code", "reason"]); text(payload.reason_code, "payload.reason_code", 200); text(payload.reason, "payload.reason", 2_000); return;
    case "BlockTask":
      payload = taskPayload(command, ["task_id", "blocker_code", "blocker_description"]); text(payload.blocker_code, "payload.blocker_code", 200); text(payload.blocker_description, "payload.blocker_description", 4_000); return;
    case "SubmitCompletion":
      payload = taskPayload(command, ["task_id", "completion_summary", "evidence_refs"]); text(payload.completion_summary, "payload.completion_summary", 8_000); if (payload.evidence_refs !== undefined) { if (!Array.isArray(payload.evidence_refs) || payload.evidence_refs.length > 100) fail("payload.evidence_refs must be an array of at most 100 UUIDs"); payload.evidence_refs.forEach((item: unknown, index: number) => uuid(item, `payload.evidence_refs[${index}]`)); } return;
    case "ApproveTask":
      payload = taskPayload(command, ["task_id", "approval_note"]); text(payload.approval_note, "payload.approval_note", 4_000); return;
    case "ReopenTask":
      payload = taskPayload(command, ["task_id", "reason"]); text(payload.reason, "payload.reason", 4_000); return;
    case "CloseTask":
      payload = taskPayload(command, ["task_id", "closure_note"]); text(payload.closure_note, "payload.closure_note", 4_000); return;
    case "CancelTask":
      payload = taskPayload(command, ["task_id", "reason_code", "reason"]); text(payload.reason_code, "payload.reason_code", 200); text(payload.reason, "payload.reason", 4_000); return;
    default: fail("command is not implemented");
  }
}
