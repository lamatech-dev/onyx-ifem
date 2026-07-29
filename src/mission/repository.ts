import type { Mission } from "./types.ts";

export interface MissionRepository {
  find(missionId: string): Promise<Mission | undefined>;
  insert(mission: Mission): Promise<void>;
}

export class InMemoryMissionRepository implements MissionRepository {
  readonly #missions = new Map<string, Mission>();

  async find(missionId: string): Promise<Mission | undefined> {
    return this.#missions.get(missionId);
  }

  async insert(mission: Mission): Promise<void> {
    this.#missions.set(mission.missionId, structuredClone(mission));
  }
}

