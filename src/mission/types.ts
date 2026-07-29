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

export interface Mission {
  missionId: UuidV7;
  organizationId: UuidV7;
  ownerId: UuidV7;
  objective: string;
  title?: string;
  initialBlueprintId?: UuidV7;
  settings: Record<string, unknown>;
  status: "DRAFT";
  version: 1;
  lifecycleEpoch: 0;
  authorityEpoch: number;
}

