import { OnyxError } from "../contracts/errors.ts";
import type { VectorClock } from "../contracts/envelopes.ts";
import { assertEmittedEvent } from "../contracts/validation.ts";
import { sha256 } from "../shared/canonical-json.ts";
import { utcInstant, uuidV7 } from "../shared/identifiers.ts";
import { toMissionView, type MissionRepository } from "./repository.ts";
import type {
  ActivateMissionCommand,
  ArchiveMissionCommand,
  CancelMissionCommand,
  CreateBlueprintRevisionCommand,
  CreateMissionCommand,
  Mission,
  MissionCommand,
  MissionEvent,
  MissionStatus,
  MissionView,
  PauseMissionCommand,
  ResumeMissionCommand,
  SubmitBlueprintCommand,
} from "./types.ts";
import {
  validateActivateMissionCommand,
  validateArchiveMissionCommand,
  validateCancelMissionCommand,
  validateCreateBlueprintRevisionCommand,
  validateCreateMissionCommand,
  validatePauseMissionCommand,
  validateResumeMissionCommand,
  validateSubmitBlueprintCommand,
} from "./validation.ts";

export interface MissionServiceOptions {
  repository: MissionRepository;
  now?: () => Date;
  replicaId?: string;
}

type MutationCommand = Exclude<MissionCommand, CreateMissionCommand>;

export class MissionService {
  readonly #repository: MissionRepository;
  readonly #now: () => Date;
  readonly #replicaId: string;

  constructor(options: MissionServiceOptions) {
    this.#repository = options.repository;
    this.#now = options.now ?? (() => new Date());
    this.#replicaId = options.replicaId ?? "mission-service";
  }

  async execute(input: unknown): Promise<MissionEvent> {
    const type = (input as {command_type?: string})?.command_type;
    switch (type) {
      case "CreateMission": return this.createMission(input);
      case "CreateBlueprintRevision": return this.createBlueprintRevision(input);
      case "SubmitBlueprint": return this.submitBlueprint(input);
      case "ActivateMission": return this.activateMission(input);
      case "PauseMission": return this.pauseMission(input);
      case "ResumeMission": return this.resumeMission(input);
      case "CancelMission": return this.cancelMission(input);
      case "ArchiveMission": return this.archiveMission(input);
      default: throw new OnyxError("INVALID_ARGUMENT", "command is not implemented or does not have a frozen payload");
    }
  }

  async createMission(input: unknown): Promise<MissionEvent> {
    validateCreateMissionCommand(input);
    const command = input;
    const replay = await this.#replay(command);
    if (replay) return replay;
    this.#authorize(command, "mission:create");
    if (command.expected_version !== undefined && command.expected_version !== 0) {
      throw new OnyxError("VERSION_CONFLICT", "a new mission must expect version 0");
    }
    if (await this.#repository.find(command.payload.mission_id)) throw new OnyxError("VERSION_CONFLICT", "mission already exists");

    const mission: Mission = {
      missionId: command.payload.mission_id,
      organizationId: command.organization_id,
      ownerId: command.payload.owner_id,
      objective: command.payload.objective,
      title: command.payload.title,
      initialBlueprintId: command.payload.initial_blueprint_id,
      settings: structuredClone(command.payload.settings),
      status: "DRAFT",
      version: 1,
      lifecycleEpoch: 0,
      authorityEpoch: command.authority_proof.authority_epoch,
      revisions: {},
    };
    return this.#publish(command, mission, "MissionCreated", structuredClone(command.payload), true);
  }

  async createBlueprintRevision(input: unknown): Promise<MissionEvent> {
    validateCreateBlueprintRevisionCommand(input);
    const command = input;
    const replay = await this.#replay(command);
    if (replay) return replay;
    const mission = await this.#loadForMutation(command, "mission:blueprint:create", ["DRAFT", "PLANNING"]);
    if (mission.revisions[command.payload.revision_id]) throw new OnyxError("VERSION_CONFLICT", "blueprint revision already exists");
    if (command.payload.base_revision_id && !mission.revisions[command.payload.base_revision_id]) {
      throw new OnyxError("INVALID_ARGUMENT", "base blueprint revision does not exist");
    }
    mission.revisions[command.payload.revision_id] = {
      revisionId: command.payload.revision_id,
      baseRevisionId: command.payload.base_revision_id,
      content: structuredClone(command.payload.content),
      changeSummary: command.payload.change_summary,
    };
    mission.status = "PLANNING";
    mission.version += 1;
    return this.#publish(command, mission, "MissionBlueprintRevisionCreated", structuredClone(command.payload));
  }

  async submitBlueprint(input: unknown): Promise<MissionEvent> {
    validateSubmitBlueprintCommand(input);
    const command = input;
    const replay = await this.#replay(command);
    if (replay) return replay;
    const mission = await this.#loadForMutation(command, "mission:blueprint:submit", ["DRAFT", "PLANNING"]);
    if (!mission.revisions[command.payload.revision_id]) throw new OnyxError("INVALID_ARGUMENT", "blueprint revision does not exist");
    mission.submittedBlueprintRevisionId = command.payload.revision_id;
    mission.status = "AWAITING_APPROVAL";
    mission.version += 1;
    return this.#publish(command, mission, "MissionBlueprintSubmitted", structuredClone(command.payload));
  }

  async activateMission(input: unknown): Promise<MissionEvent> {
    validateActivateMissionCommand(input);
    const command = input;
    const replay = await this.#replay(command);
    if (replay) return replay;
    const mission = await this.#loadForMutation(command, "mission:activate", ["AWAITING_APPROVAL"]);
    if (mission.submittedBlueprintRevisionId !== command.payload.approved_revision_id) {
      throw new OnyxError("INVALID_ARGUMENT", "approved revision must match the submitted revision");
    }
    mission.activeBlueprintRevisionId = command.payload.approved_revision_id;
    mission.timelineId = command.payload.timeline_id;
    mission.status = "ACTIVE";
    mission.version += 1;
    return this.#publish(command, mission, "MissionActivated", {new_status: "ACTIVE"});
  }

  async pauseMission(input: unknown): Promise<MissionEvent> {
    validatePauseMissionCommand(input);
    const command = input;
    const replay = await this.#replay(command);
    if (replay) return replay;
    const mission = await this.#loadForMutation(command, "mission:pause", ["ACTIVE"]);
    mission.status = "PAUSED";
    mission.version += 1;
    return this.#publish(command, mission, "MissionPaused", {new_status: "PAUSED"});
  }

  async resumeMission(input: unknown): Promise<MissionEvent> {
    validateResumeMissionCommand(input);
    const command = input;
    const replay = await this.#replay(command);
    if (replay) return replay;
    const mission = await this.#loadForMutation(command, "mission:resume", ["PAUSED"]);
    mission.status = "ACTIVE";
    mission.version += 1;
    return this.#publish(command, mission, "MissionResumed", {new_status: "ACTIVE"});
  }

  async cancelMission(input: unknown): Promise<MissionEvent> {
    validateCancelMissionCommand(input);
    const command = input;
    const replay = await this.#replay(command);
    if (replay) return replay;
    const mission = await this.#loadForMutation(command, "mission:cancel", ["DRAFT", "PLANNING", "AWAITING_APPROVAL", "ACTIVE", "PAUSED", "HALTED", "REVIEW"]);
    mission.status = "CANCELLED";
    mission.version += 1;
    mission.lifecycleEpoch += 1;
    return this.#publish(command, mission, "MissionCancelled", {new_status: "CANCELLED"});
  }

  async archiveMission(input: unknown): Promise<MissionEvent> {
    validateArchiveMissionCommand(input);
    const command = input;
    const replay = await this.#replay(command);
    if (replay) return replay;
    const mission = await this.#loadForMutation(command, "mission:archive", ["CLOSED", "CANCELLED"]);
    mission.status = "ARCHIVED";
    mission.version += 1;
    return this.#publish(command, mission, "MissionArchived", {new_status: "ARCHIVED"});
  }

  async getMission(organizationId: string, missionId: string): Promise<MissionView> {
    const mission = await this.#repository.find(missionId);
    if (!mission || mission.organizationId !== organizationId) throw new OnyxError("NOT_FOUND", "mission not found");
    return toMissionView(mission);
  }

  async listMissions(organizationId: string): Promise<MissionView[]> {
    return (await this.#repository.list(organizationId)).map(toMissionView);
  }

  async getHistory(organizationId: string, missionId: string, afterVersion = 0, limit = 100): Promise<MissionEvent[]> {
    await this.getMission(organizationId, missionId);
    if (!Number.isInteger(afterVersion) || afterVersion < 0 || !Number.isInteger(limit) || limit < 1 || limit > 1_000) {
      throw new OnyxError("INVALID_ARGUMENT", "history bounds are invalid");
    }
    return this.#repository.history(missionId, afterVersion, limit);
  }

  async #loadForMutation(command: MutationCommand, scope: string, allowed: MissionStatus[]): Promise<Mission> {
    this.#authorize(command, scope);
    const mission = await this.#repository.find(command.payload.mission_id);
    if (!mission) throw new OnyxError("NOT_FOUND", "mission not found");
    if (mission.organizationId !== command.organization_id) throw new OnyxError("ORGANIZATION_MISMATCH", "mission belongs to another organization");
    if (command.expected_version !== undefined && command.expected_version !== mission.version) {
      throw new OnyxError("VERSION_CONFLICT", "expected_version does not match", {expected: command.expected_version, actual: mission.version});
    }
    if (command.expected_lifecycle_epoch !== undefined && command.expected_lifecycle_epoch !== mission.lifecycleEpoch) {
      throw new OnyxError("LIFECYCLE_EPOCH_MISMATCH", "expected_lifecycle_epoch does not match");
    }
    if (command.expected_authority_epoch !== undefined && command.expected_authority_epoch !== mission.authorityEpoch) {
      throw new OnyxError("AUTHORITY_EPOCH_MISMATCH", "expected_authority_epoch does not match");
    }
    if (!allowed.includes(mission.status)) {
      throw new OnyxError("INVALID_STATE_TRANSITION", `${command.command_type} is not valid from ${mission.status}`);
    }
    return mission;
  }

  #authorize(command: MissionCommand, scope: string): void {
    if (!command.authority_proof.scope.includes(scope) || Date.parse(command.authority_proof.expires_at) <= this.#now().getTime()) {
      throw new OnyxError("AUTHORITY_PROOF_INVALID", `${scope} authority is missing or expired`);
    }
  }

  async #replay(command: MissionCommand): Promise<MissionEvent | undefined> {
    const fingerprint = sha256(command);
    const prior = await this.#repository.findOperation(command.operation_id);
    if (!prior) return undefined;
    if (prior.fingerprint !== fingerprint) throw new OnyxError("IDEMPOTENCY_KEY_REUSE", "operation_id was reused with a different command");
    return prior.event;
  }

  async #publish<TType extends MissionEvent["event_type"], TPayload>(
    command: MissionCommand,
    mission: Mission,
    eventType: TType,
    payload: TPayload,
    create = false,
  ): Promise<MissionEvent> {
    const now = this.#now();
    const occurredAt = utcInstant(now);
    const eventWithoutDigest = {
      event_id: uuidV7(now),
      event_type: eventType,
      schema_version: 1 as const,
      organization_id: command.organization_id,
      aggregate: {aggregate_type: "Mission", object_id: mission.missionId},
      aggregate_version: mission.version,
      lifecycle_epoch: mission.lifecycleEpoch,
      authority_epoch: mission.authorityEpoch,
      operation_id: command.operation_id,
      actor_context: command.actor_context,
      occurred_at: occurredAt,
      recorded_at: occurredAt,
      vector_clock: this.#advanceClock(command.vector_clock),
      correlation_id: command.correlation_id,
      causation_id: command.command_id,
      payload,
    };
    const event = {
      ...eventWithoutDigest,
      audit: {provenance: `${command.command_type}@1`, integrity_digest: sha256(eventWithoutDigest)},
    } as MissionEvent;
    assertEmittedEvent(event, eventType, "Mission");
    await this.#repository.commit(
      mission,
      event,
      command.operation_id,
      {fingerprint: sha256(command), event},
      create,
    );
    return structuredClone(event);
  }

  #advanceClock(clock: VectorClock): VectorClock {
    return {...clock, [this.#replicaId]: (clock[this.#replicaId] ?? 0) + 1};
  }
}
