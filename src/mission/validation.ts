import { OnyxError } from "../contracts/errors.ts";
import type {
  ActivateMissionCommand,
  ArchiveMissionCommand,
  CancelMissionCommand,
  CreateBlueprintRevisionCommand,
  CreateMissionCommand,
  MissionCommand,
  PauseMissionCommand,
  ResumeMissionCommand,
  SubmitBlueprintCommand,
} from "./types.ts";

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const UTC_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;

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

function exactKeys(payload: Record<string, unknown>, allowed: string[]): void {
  const allowedSet = new Set(allowed);
  const unknownKeys = Object.keys(payload).filter((key) => !allowedSet.has(key));
  if (unknownKeys.length > 0) fail("payload contains unknown fields", {unknownKeys});
}

function validateEnvelope(value: unknown, type: MissionCommand["command_type"]): Record<string, any> {
  const command = object(value, "command");
  if (command.command_type !== type || command.schema_version !== 1) fail("unsupported command type or schema version");
  for (const field of ["command_id", "operation_id", "organization_id", "correlation_id"]) uuid(command[field], field);
  const target = object(command.target, "target");
  uuid(target.object_id, "target.object_id");
  if (target.aggregate_type !== "Mission") fail("target.aggregate_type must be Mission");
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
  return command;
}

function validateMissionTarget(command: Record<string, any>, payload: Record<string, any>): void {
  uuid(payload.mission_id, "payload.mission_id");
  if (command.target.object_id !== payload.mission_id) fail("target object must match payload mission_id");
}

export function validateCreateMissionCommand(value: unknown): asserts value is CreateMissionCommand {
  const command = validateEnvelope(value, "CreateMission");
  const payload = object(command.payload, "payload");
  exactKeys(payload, ["mission_id", "objective", "owner_id", "settings", "title", "initial_blueprint_id"]);
  validateMissionTarget(command, payload);
  uuid(payload.owner_id, "payload.owner_id");
  text(payload.objective, "payload.objective", 4_000);
  object(payload.settings, "payload.settings");
  if (payload.title !== undefined) text(payload.title, "payload.title", 200);
  if (payload.initial_blueprint_id !== undefined) uuid(payload.initial_blueprint_id, "payload.initial_blueprint_id");
}

export function validateCreateBlueprintRevisionCommand(value: unknown): asserts value is CreateBlueprintRevisionCommand {
  const command = validateEnvelope(value, "CreateBlueprintRevision");
  const payload = object(command.payload, "payload");
  exactKeys(payload, ["mission_id", "revision_id", "content", "change_summary", "base_revision_id"]);
  validateMissionTarget(command, payload);
  uuid(payload.revision_id, "payload.revision_id");
  if (!("content" in payload)) fail("payload.content is required");
  text(payload.change_summary, "payload.change_summary", 2_000);
  if (payload.base_revision_id !== undefined) uuid(payload.base_revision_id, "payload.base_revision_id");
}

export function validateSubmitBlueprintCommand(value: unknown): asserts value is SubmitBlueprintCommand {
  const command = validateEnvelope(value, "SubmitBlueprint");
  const payload = object(command.payload, "payload");
  exactKeys(payload, ["mission_id", "revision_id", "required_approval_policy_id"]);
  validateMissionTarget(command, payload);
  uuid(payload.revision_id, "payload.revision_id");
  if (payload.required_approval_policy_id !== undefined) uuid(payload.required_approval_policy_id, "payload.required_approval_policy_id");
}

export function validateActivateMissionCommand(value: unknown): asserts value is ActivateMissionCommand {
  const command = validateEnvelope(value, "ActivateMission");
  const payload = object(command.payload, "payload");
  exactKeys(payload, ["mission_id", "approved_revision_id", "timeline_id", "approval_id"]);
  validateMissionTarget(command, payload);
  uuid(payload.approved_revision_id, "payload.approved_revision_id");
  uuid(payload.timeline_id, "payload.timeline_id");
  if (payload.approval_id !== undefined) uuid(payload.approval_id, "payload.approval_id");
}

function validateReasonCommand(value: unknown, type: "PauseMission" | "CancelMission"): void {
  const command = validateEnvelope(value, type);
  const payload = object(command.payload, "payload");
  exactKeys(payload, ["mission_id", "reason_code", "reason"]);
  validateMissionTarget(command, payload);
  text(payload.reason_code, "payload.reason_code");
  text(payload.reason, "payload.reason", type === "PauseMission" ? 2_000 : undefined);
}

export function validatePauseMissionCommand(value: unknown): asserts value is PauseMissionCommand {
  validateReasonCommand(value, "PauseMission");
}

export function validateCancelMissionCommand(value: unknown): asserts value is CancelMissionCommand {
  validateReasonCommand(value, "CancelMission");
}

export function validateResumeMissionCommand(value: unknown): asserts value is ResumeMissionCommand {
  const command = validateEnvelope(value, "ResumeMission");
  const payload = object(command.payload, "payload");
  exactKeys(payload, ["mission_id", "resume_note"]);
  validateMissionTarget(command, payload);
  text(payload.resume_note, "payload.resume_note", 2_000);
}

export function validateArchiveMissionCommand(value: unknown): asserts value is ArchiveMissionCommand {
  const command = validateEnvelope(value, "ArchiveMission");
  const payload = object(command.payload, "payload");
  exactKeys(payload, ["mission_id", "retention_policy_id"]);
  validateMissionTarget(command, payload);
  uuid(payload.retention_policy_id, "payload.retention_policy_id");
}
