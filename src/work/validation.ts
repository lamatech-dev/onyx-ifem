import { OnyxError } from "../contracts/errors.ts";
import type { CreateTaskCommand } from "./types.ts";

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const UTC_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
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

function fail(message: string, details?: Record<string, unknown>): never {
  throw new OnyxError("INVALID_ARGUMENT", message, details);
}

function object(value: unknown, field: string): Record<string, any> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail(`${field} must be an object`);
  return value as Record<string, any>;
}

function uuid(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || !UUID_V7.test(value)) fail(`${field} must be a canonical UUIDv7`);
}

function text(value: unknown, field: string, max?: number): asserts value is string {
  if (typeof value !== "string" || value.length < 1 || (max !== undefined && value.length > max)) {
    fail(`${field} must contain 1${max ? ` to ${max}` : " or more"} characters`);
  }
}

export function validateCreateTaskCommand(value: unknown): asserts value is CreateTaskCommand {
  const command = object(value, "command");
  if (command.command_type !== "CreateTask" || command.schema_version !== 1) fail("unsupported command type or schema version");
  for (const field of ["command_id", "operation_id", "organization_id", "correlation_id"]) uuid(command[field], field);
  const target = object(command.target, "target");
  uuid(target.object_id, "target.object_id");
  if (target.aggregate_type !== "Task") fail("target.aggregate_type must be Task");
  const actor = object(command.actor_context, "actor_context");
  uuid(actor.principal_id, "actor_context.principal_id");
  const proof = object(command.authority_proof, "authority_proof");
  if (!Array.isArray(proof.scope) || proof.scope.length === 0) fail("authority_proof.scope must not be empty");
  if (typeof proof.authority_epoch !== "number" || !Number.isInteger(proof.authority_epoch) || proof.authority_epoch < 0) {
    fail("authority_proof.authority_epoch must be a non-negative integer");
  }
  for (const [field, instant] of [["issued_at", command.issued_at], ["authority_proof.expires_at", proof.expires_at]] as const) {
    if (typeof instant !== "string" || !UTC_INSTANT.test(instant) || Number.isNaN(Date.parse(instant))) fail(`${field} must be a canonical UTC instant`);
  }

  const payload = object(command.payload, "payload");
  const unknownKeys = Object.keys(payload).filter((key) => !PAYLOAD_KEYS.has(key));
  if (unknownKeys.length > 0) fail("payload contains unknown fields", {unknownKeys});
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
