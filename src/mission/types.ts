import type { CommandEnvelope, EventEnvelope, UuidV7 } from "../contracts/envelopes.ts";

export interface CreateMissionPayload {
  mission_id: UuidV7;
  objective: string;
  owner_id: UuidV7;
  settings: Record<string, unknown>;
  title?: string;
  initial_blueprint_id?: UuidV7;
}

export type CreateMissionCommand = CommandEnvelope<"CreateMission", CreateMissionPayload>;
export type MissionCreatedEvent = EventEnvelope<"MissionCreated", CreateMissionPayload>;

export interface CreateBlueprintRevisionPayload {
  mission_id: UuidV7;
  revision_id: UuidV7;
  content: unknown;
  change_summary: string;
  base_revision_id?: UuidV7;
}

export interface SubmitBlueprintPayload {
  mission_id: UuidV7;
  revision_id: UuidV7;
  required_approval_policy_id?: UuidV7;
}

export interface ActivateMissionPayload {
  mission_id: UuidV7;
  approved_revision_id: UuidV7;
  timeline_id: UuidV7;
  approval_id?: UuidV7;
}

export interface PauseMissionPayload {
  mission_id: UuidV7;
  reason_code: string;
  reason: string;
}

export interface ResumeMissionPayload {
  mission_id: UuidV7;
  resume_note: string;
}

export interface OperationalHaltMissionPayload {
  mission_id: UuidV7;
  reason_code: string;
  reason: string;
  incident_id?: UuidV7;
}

export interface RestartMissionPayload {
  mission_id: UuidV7;
  restart_note: string;
  timeline_id?: UuidV7;
}

export interface CloseMissionPayload {
  mission_id: UuidV7;
  outcome_code: string;
  outcome_summary: string;
}

export interface CancelMissionPayload {
  mission_id: UuidV7;
  reason_code: string;
  reason: string;
}

export interface ArchiveMissionPayload {
  mission_id: UuidV7;
  retention_policy_id: UuidV7;
}

export type CreateBlueprintRevisionCommand = CommandEnvelope<"CreateBlueprintRevision", CreateBlueprintRevisionPayload>;
export type SubmitBlueprintCommand = CommandEnvelope<"SubmitBlueprint", SubmitBlueprintPayload>;
export type ActivateMissionCommand = CommandEnvelope<"ActivateMission", ActivateMissionPayload>;
export type PauseMissionCommand = CommandEnvelope<"PauseMission", PauseMissionPayload>;
export type ResumeMissionCommand = CommandEnvelope<"ResumeMission", ResumeMissionPayload>;
export type OperationalHaltMissionCommand = CommandEnvelope<"OperationalHaltMission", OperationalHaltMissionPayload>;
export type RestartMissionCommand = CommandEnvelope<"RestartMission", RestartMissionPayload>;
export type CloseMissionCommand = CommandEnvelope<"CloseMission", CloseMissionPayload>;
export type CancelMissionCommand = CommandEnvelope<"CancelMission", CancelMissionPayload>;
export type ArchiveMissionCommand = CommandEnvelope<"ArchiveMission", ArchiveMissionPayload>;

export type MissionCommand =
  | CreateMissionCommand
  | CreateBlueprintRevisionCommand
  | SubmitBlueprintCommand
  | ActivateMissionCommand
  | PauseMissionCommand
  | ResumeMissionCommand
  | OperationalHaltMissionCommand
  | RestartMissionCommand
  | CloseMissionCommand
  | CancelMissionCommand
  | ArchiveMissionCommand;

export type MissionEvent =
  | MissionCreatedEvent
  | EventEnvelope<"MissionBlueprintRevisionCreated", CreateBlueprintRevisionPayload>
  | EventEnvelope<"MissionBlueprintSubmitted", SubmitBlueprintPayload>
  | EventEnvelope<"MissionActivated", {new_status: "ACTIVE"}>
  | EventEnvelope<"MissionPaused", {new_status: "PAUSED"}>
  | EventEnvelope<"MissionResumed", {new_status: "ACTIVE"}>
  | EventEnvelope<"MissionOperationallyHalted", {new_status: "HALTED"}>
  | EventEnvelope<"MissionRestarted", {new_status: "ACTIVE"}>
  | EventEnvelope<"MissionClosed", {new_status: "CLOSED"}>
  | EventEnvelope<"MissionCancelled", {new_status: "CANCELLED"}>
  | EventEnvelope<"MissionArchived", {new_status: "ARCHIVED"}>;

export type MissionStatus =
  | "DRAFT"
  | "PLANNING"
  | "AWAITING_APPROVAL"
  | "ACTIVE"
  | "PAUSED"
  | "HALTED"
  | "REVIEW"
  | "CLOSED"
  | "ARCHIVED"
  | "CANCELLED";

export interface BlueprintRevision {
  revisionId: UuidV7;
  baseRevisionId?: UuidV7;
  content: unknown;
  changeSummary: string;
}

export interface Mission {
  missionId: UuidV7;
  organizationId: UuidV7;
  ownerId: UuidV7;
  objective: string;
  title?: string;
  initialBlueprintId?: UuidV7;
  settings: Record<string, unknown>;
  status: MissionStatus;
  version: number;
  lifecycleEpoch: number;
  authorityEpoch: number;
  activeBlueprintRevisionId?: UuidV7;
  submittedBlueprintRevisionId?: UuidV7;
  timelineId?: UuidV7;
  revisions: Record<UuidV7, BlueprintRevision>;
}

export interface MissionView {
  mission_id: UuidV7;
  organization_id: UuidV7;
  objective: string;
  owner_id: UuidV7;
  status: MissionStatus;
  version: number;
  lifecycle_epoch: number;
  authority_epoch: number;
  title?: string;
  active_blueprint_revision_id?: UuidV7;
  timeline_id?: UuidV7;
}
