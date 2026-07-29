import type { Mission, MissionEvent, MissionView } from "./types.ts";

export interface OperationRecord {
  fingerprint: string;
  event: MissionEvent;
}

export interface MissionRepository {
  find(missionId: string): Promise<Mission | undefined>;
  list(organizationId: string): Promise<Mission[]>;
  history(missionId: string, afterVersion?: number, limit?: number): Promise<MissionEvent[]>;
  findOperation(operationId: string): Promise<OperationRecord | undefined>;
  commit(mission: Mission, event: MissionEvent, operationId: string, record: OperationRecord, create: boolean): Promise<void>;
}

export class InMemoryMissionRepository implements MissionRepository {
  readonly #missions = new Map<string, Mission>();
  readonly #events = new Map<string, MissionEvent[]>();
  readonly #operations = new Map<string, OperationRecord>();

  async find(missionId: string): Promise<Mission | undefined> {
    const mission = this.#missions.get(missionId);
    return mission && structuredClone(mission);
  }

  async list(organizationId: string): Promise<Mission[]> {
    return [...this.#missions.values()]
      .filter((mission) => mission.organizationId === organizationId)
      .sort((left, right) => left.missionId.localeCompare(right.missionId))
      .map((mission) => structuredClone(mission));
  }

  async history(missionId: string, afterVersion = 0, limit = 100): Promise<MissionEvent[]> {
    return (this.#events.get(missionId) ?? [])
      .filter((event) => event.aggregate_version > afterVersion)
      .slice(0, limit)
      .map((event) => structuredClone(event));
  }

  async findOperation(operationId: string): Promise<OperationRecord | undefined> {
    const record = this.#operations.get(operationId);
    return record && structuredClone(record);
  }

  async commit(mission: Mission, event: MissionEvent, operationId: string, record: OperationRecord, create: boolean): Promise<void> {
    if (create && this.#missions.has(mission.missionId)) throw new Error("mission already exists during commit");
    if (!create && !this.#missions.has(mission.missionId)) throw new Error("mission does not exist during commit");
    if (this.#operations.has(operationId)) throw new Error("operation already exists during commit");

    const events = this.#events.get(mission.missionId) ?? [];
    events.push(structuredClone(event));
    this.#events.set(mission.missionId, events);
    this.#missions.set(mission.missionId, structuredClone(mission));
    this.#operations.set(operationId, structuredClone(record));
  }
}

export function toMissionView(mission: Mission): MissionView {
  return {
    mission_id: mission.missionId,
    organization_id: mission.organizationId,
    objective: mission.objective,
    owner_id: mission.ownerId,
    status: mission.status,
    version: mission.version,
    lifecycle_epoch: mission.lifecycleEpoch,
    authority_epoch: mission.authorityEpoch,
    ...(mission.title !== undefined ? {title: mission.title} : {}),
    ...(mission.activeBlueprintRevisionId !== undefined ? {active_blueprint_revision_id: mission.activeBlueprintRevisionId} : {}),
    ...(mission.timelineId !== undefined ? {timeline_id: mission.timelineId} : {}),
  };
}
