import { OnyxError } from "../contracts/errors.ts";
import { canonicalJson, sha256 } from "../shared/canonical-json.ts";
import { utcInstant, uuidV7 } from "../shared/identifiers.ts";
import type { MissionRepository } from "./repository.ts";
import type { CreateMissionCommand, Mission, MissionCreatedEvent } from "./types.ts";
import { validateCreateMissionCommand } from "./validation.ts";

export interface MissionServiceOptions {
  repository: MissionRepository;
  now?: () => Date;
  replicaId?: string;
}

interface JournalEntry {
  fingerprint: string;
  event: MissionCreatedEvent;
}

export class MissionService {
  readonly #repository: MissionRepository;
  readonly #now: () => Date;
  readonly #replicaId: string;
  readonly #journal = new Map<string, JournalEntry>();

  constructor(options: MissionServiceOptions) {
    this.#repository = options.repository;
    this.#now = options.now ?? (() => new Date());
    this.#replicaId = options.replicaId ?? "mission-service";
  }

  async createMission(input: unknown): Promise<MissionCreatedEvent> {
    validateCreateMissionCommand(input);
    const command: CreateMissionCommand = input;
    const fingerprint = sha256(command);
    const prior = this.#journal.get(command.operation_id);
    if (prior) {
      if (prior.fingerprint !== fingerprint) {
        throw new OnyxError("IDEMPOTENCY_KEY_REUSE", "operation_id was reused with a different command");
      }
      return structuredClone(prior.event);
    }

    const now = this.#now();
    if (!command.authority_proof.scope.includes("mission:create") || Date.parse(command.authority_proof.expires_at) <= now.getTime()) {
      throw new OnyxError("AUTHORITY_PROOF_INVALID", "mission:create authority is missing or expired");
    }
    if (command.expected_version !== undefined && command.expected_version !== 0) {
      throw new OnyxError("VERSION_CONFLICT", "a new mission must expect version 0");
    }
    if (await this.#repository.find(command.payload.mission_id)) {
      throw new OnyxError("VERSION_CONFLICT", "mission already exists");
    }

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
    };
    await this.#repository.insert(mission);

    const occurredAt = utcInstant(now);
    const eventWithoutDigest = {
      event_id: uuidV7(now),
      event_type: "MissionCreated" as const,
      schema_version: 1 as const,
      organization_id: command.organization_id,
      aggregate: {aggregate_type: "Mission", object_id: command.payload.mission_id},
      aggregate_version: 1,
      lifecycle_epoch: 0,
      authority_epoch: command.authority_proof.authority_epoch,
      operation_id: command.operation_id,
      actor_context: command.actor_context,
      occurred_at: occurredAt,
      recorded_at: occurredAt,
      vector_clock: {
        ...command.vector_clock,
        [this.#replicaId]: (command.vector_clock[this.#replicaId] ?? 0) + 1,
      },
      correlation_id: command.correlation_id,
      causation_id: command.command_id,
      payload: structuredClone(command.payload),
    };
    const event: MissionCreatedEvent = {
      ...eventWithoutDigest,
      audit: {
        provenance: "CreateMission@1",
        integrity_digest: sha256(eventWithoutDigest),
      },
    };

    this.#journal.set(command.operation_id, {fingerprint, event: structuredClone(event)});
    return event;
  }

  operationFingerprint(command: CreateMissionCommand): string {
    return canonicalJson(command);
  }
}

