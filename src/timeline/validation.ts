import { OnyxError } from "../contracts/errors.ts";
import type { CreateTimelineCommand } from "./types.ts";

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const UTC_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const PAYLOAD_KEYS = new Set(["timeline_id", "subject_ref", "timezone"]);
const REFERENCE_KEYS = new Set(["aggregate_type", "object_id"]);

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

function exactKeys(value: Record<string, any>, allowed: Set<string>, field: string): void {
  const unknownKeys = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknownKeys.length > 0) fail(`${field} contains unknown fields`, {unknownKeys});
}

export function validateCreateTimelineCommand(value: unknown): asserts value is CreateTimelineCommand {
  const command = object(value, "command");
  if (command.command_type !== "CreateTimeline" || command.schema_version !== 1) fail("unsupported command type or schema version");
  for (const field of ["command_id", "operation_id", "organization_id", "correlation_id"]) uuid(command[field], field);

  const target = object(command.target, "target");
  uuid(target.object_id, "target.object_id");
  if (target.aggregate_type !== "Timeline") fail("target.aggregate_type must be Timeline");

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
  exactKeys(payload, PAYLOAD_KEYS, "payload");
  uuid(payload.timeline_id, "payload.timeline_id");
  if (typeof payload.timezone !== "string" || payload.timezone.length < 1) fail("payload.timezone must not be empty");
  const subject = object(payload.subject_ref, "payload.subject_ref");
  exactKeys(subject, REFERENCE_KEYS, "payload.subject_ref");
  if (typeof subject.aggregate_type !== "string" || subject.aggregate_type.length < 1) fail("payload.subject_ref.aggregate_type must not be empty");
  uuid(subject.object_id, "payload.subject_ref.object_id");
  if (target.object_id !== payload.timeline_id) fail("target object must match payload timeline_id");
}
