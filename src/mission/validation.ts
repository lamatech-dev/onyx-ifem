import { OnyxError } from "../contracts/errors.ts";
import type { CreateMissionCommand, CreateMissionPayload } from "./types.ts";

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const UTC_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const PAYLOAD_KEYS = new Set([
  "mission_id",
  "objective",
  "owner_id",
  "settings",
  "title",
  "initial_blueprint_id",
]);

function requireUuid(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || !UUID_V7.test(value)) {
    throw new OnyxError("INVALID_ARGUMENT", `${field} must be a canonical UUIDv7`);
  }
}

function requirePayload(value: unknown): asserts value is CreateMissionPayload {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new OnyxError("INVALID_ARGUMENT", "payload must be an object");
  }
  const payload = value as Record<string, unknown>;
  const unknownKeys = Object.keys(payload).filter((key) => !PAYLOAD_KEYS.has(key));
  if (unknownKeys.length > 0) {
    throw new OnyxError("INVALID_ARGUMENT", "payload contains unknown fields", {unknownKeys});
  }
  requireUuid(payload.mission_id, "payload.mission_id");
  requireUuid(payload.owner_id, "payload.owner_id");
  if (payload.initial_blueprint_id !== undefined) {
    requireUuid(payload.initial_blueprint_id, "payload.initial_blueprint_id");
  }
  if (typeof payload.objective !== "string" || payload.objective.length < 1 || payload.objective.length > 4_000) {
    throw new OnyxError("INVALID_ARGUMENT", "payload.objective must contain 1 to 4000 characters");
  }
  if (payload.title !== undefined && (typeof payload.title !== "string" || payload.title.length < 1 || payload.title.length > 200)) {
    throw new OnyxError("INVALID_ARGUMENT", "payload.title must contain 1 to 200 characters");
  }
  if (payload.settings === null || typeof payload.settings !== "object" || Array.isArray(payload.settings)) {
    throw new OnyxError("INVALID_ARGUMENT", "payload.settings must be an object");
  }
}

export function validateCreateMissionCommand(value: unknown): asserts value is CreateMissionCommand {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new OnyxError("INVALID_ARGUMENT", "command must be an object");
  }
  const command = value as Record<string, any>;
  if (command.command_type !== "CreateMission" || command.schema_version !== 1) {
    throw new OnyxError("INVALID_ARGUMENT", "unsupported command type or schema version");
  }
  for (const field of ["command_id", "operation_id", "organization_id", "correlation_id"]) {
    requireUuid(command[field], field);
  }
  requireUuid(command.target?.object_id, "target.object_id");
  requireUuid(command.actor_context?.principal_id, "actor_context.principal_id");
  if (command.target?.aggregate_type !== "Mission") {
    throw new OnyxError("INVALID_ARGUMENT", "target.aggregate_type must be Mission");
  }
  if (!UTC_INSTANT.test(command.issued_at) || Number.isNaN(Date.parse(command.issued_at))) {
    throw new OnyxError("INVALID_ARGUMENT", "issued_at must be a canonical UTC instant");
  }
  if (!Array.isArray(command.authority_proof?.scope) || command.authority_proof.scope.length === 0) {
    throw new OnyxError("INVALID_ARGUMENT", "authority_proof.scope must not be empty");
  }
  if (!UTC_INSTANT.test(command.authority_proof?.expires_at) || Number.isNaN(Date.parse(command.authority_proof.expires_at))) {
    throw new OnyxError("INVALID_ARGUMENT", "authority_proof.expires_at must be a canonical UTC instant");
  }
  requirePayload(command.payload);
  if (command.target.object_id !== command.payload.mission_id) {
    throw new OnyxError("INVALID_ARGUMENT", "target object must match payload mission_id");
  }
}

