import { exactKeys, fail, object, text, uuid, validateCommandEnvelope } from "../contracts/validation.ts";
import type { CreateTaskCommand } from "./types.ts";

const PAYLOAD_KEYS = new Set([
  "task_id",
  "mission_id",
  "title",
  "description",
  "owner_id",
  "priority",
  "due_date_ref",
  "estimate",
]);

export function validateCreateTaskCommand(value: unknown): asserts value is CreateTaskCommand {
  const command = validateCommandEnvelope(value, "CreateTask", "Task");
  const target = command.target;

  const payload = object(command.payload, "payload");
  exactKeys(payload, PAYLOAD_KEYS, "payload");
  uuid(payload.task_id, "payload.task_id");
  uuid(payload.mission_id, "payload.mission_id");
  uuid(payload.owner_id, "payload.owner_id");
  text(payload.title, "payload.title", 200);
  if (typeof payload.description !== "string" || payload.description.length > 8_000) fail("payload.description must contain at most 8000 characters");
  if (typeof payload.priority !== "string") fail("payload.priority must be a string");
  if (payload.due_date_ref !== undefined) object(payload.due_date_ref, "payload.due_date_ref");
  if (payload.estimate !== undefined) object(payload.estimate, "payload.estimate");
  if (target.object_id !== payload.task_id) fail("target object must match payload task_id");
}
