import {
  exactKeys as validateExactKeys,
  fail,
  object,
  text,
  uuid,
  validateCommandEnvelope,
} from "../contracts/validation.ts";
import type {
  ActivateMissionCommand,
  ArchiveMissionCommand,
  CancelMissionCommand,
  CloseMissionCommand,
  CreateBlueprintRevisionCommand,
  CreateMissionCommand,
  MissionCommand,
  PauseMissionCommand,
  OperationalHaltMissionCommand,
  RestartMissionCommand,
  ResumeMissionCommand,
  SubmitBlueprintCommand,
} from "./types.ts";

function exactKeys(payload: Record<string, unknown>, allowed: string[]): void {
  validateExactKeys(payload, allowed, "payload");
}

function validateEnvelope(value: unknown, type: MissionCommand["command_type"]): Record<string, any> {
  return validateCommandEnvelope(value, type, "Mission");
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

export function validateOperationalHaltMissionCommand(value: unknown): asserts value is OperationalHaltMissionCommand {
  const command = validateEnvelope(value, "OperationalHaltMission");
  const payload = object(command.payload, "payload");
  exactKeys(payload, ["mission_id", "reason_code", "reason", "incident_id"]);
  validateMissionTarget(command, payload);
  text(payload.reason_code, "payload.reason_code", 200);
  text(payload.reason, "payload.reason", 2_000);
  if (payload.incident_id !== undefined) uuid(payload.incident_id, "payload.incident_id");
}

export function validateRestartMissionCommand(value: unknown): asserts value is RestartMissionCommand {
  const command = validateEnvelope(value, "RestartMission");
  const payload = object(command.payload, "payload");
  exactKeys(payload, ["mission_id", "restart_note", "timeline_id"]);
  validateMissionTarget(command, payload);
  text(payload.restart_note, "payload.restart_note", 2_000);
  if (payload.timeline_id !== undefined) uuid(payload.timeline_id, "payload.timeline_id");
}

export function validateCloseMissionCommand(value: unknown): asserts value is CloseMissionCommand {
  const command = validateEnvelope(value, "CloseMission");
  const payload = object(command.payload, "payload");
  exactKeys(payload, ["mission_id", "outcome_code", "outcome_summary"]);
  validateMissionTarget(command, payload);
  text(payload.outcome_code, "payload.outcome_code", 200);
  text(payload.outcome_summary, "payload.outcome_summary", 4_000);
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
