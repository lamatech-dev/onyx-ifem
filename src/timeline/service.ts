import type { DomainObjectRef } from "../contracts/envelopes.ts";
import { OnyxError } from "../contracts/errors.ts";
import { sha256 } from "../shared/canonical-json.ts";
import { utcInstant, uuidV7 } from "../shared/identifiers.ts";
import { toTimelineView, type TimelineRepository } from "./repository.ts";
import type { Timeline, TimelineCreatedEvent, TimelineView } from "./types.ts";
import { validateCreateTimelineCommand } from "./validation.ts";

export interface TimelineServiceOptions {
  repository: TimelineRepository;
  requireSubject: (organizationId: string, subject: DomainObjectRef) => Promise<void>;
  now?: () => Date;
  replicaId?: string;
}

export class TimelineService {
  readonly #repository: TimelineRepository;
  readonly #requireSubject: TimelineServiceOptions["requireSubject"];
  readonly #now: () => Date;
  readonly #replicaId: string;

  constructor(options: TimelineServiceOptions) {
    this.#repository = options.repository;
    this.#requireSubject = options.requireSubject;
    this.#now = options.now ?? (() => new Date());
    this.#replicaId = options.replicaId ?? "timeline-service";
  }

  async execute(input: unknown): Promise<TimelineCreatedEvent> {
    if ((input as {command_type?: string})?.command_type !== "CreateTimeline") {
      throw new OnyxError("INVALID_ARGUMENT", "command is not implemented because its payload is not frozen");
    }
    return this.createTimeline(input);
  }

  async createTimeline(input: unknown): Promise<TimelineCreatedEvent> {
    validateCreateTimelineCommand(input);
    const command = input;
    const fingerprint = sha256(command);
    const prior = await this.#repository.findOperation(command.operation_id);
    if (prior) {
      if (prior.fingerprint !== fingerprint) throw new OnyxError("IDEMPOTENCY_KEY_REUSE", "operation_id was reused with a different command");
      return structuredClone(prior.event);
    }
    if (!command.authority_proof.scope.includes("timeline:create") || Date.parse(command.authority_proof.expires_at) <= this.#now().getTime()) {
      throw new OnyxError("AUTHORITY_PROOF_INVALID", "timeline:create authority is missing or expired");
    }
    if (command.expected_version !== undefined && command.expected_version !== 0) {
      throw new OnyxError("VERSION_CONFLICT", "a new timeline must expect version 0");
    }
    if (await this.#repository.find(command.payload.timeline_id)) throw new OnyxError("VERSION_CONFLICT", "timeline already exists");
    await this.#requireSubject(command.organization_id, command.payload.subject_ref);

    const timeline: Timeline = {
      timelineId: command.payload.timeline_id,
      organizationId: command.organization_id,
      subjectRef: structuredClone(command.payload.subject_ref),
      timezone: command.payload.timezone,
      version: 1,
    };
    const now = this.#now();
    const occurredAt = utcInstant(now);
    const eventWithoutDigest = {
      event_id: uuidV7(now),
      event_type: "TimelineCreated" as const,
      schema_version: 1 as const,
      organization_id: command.organization_id,
      aggregate: {aggregate_type: "Timeline", object_id: command.payload.timeline_id},
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
    const event: TimelineCreatedEvent = {
      ...eventWithoutDigest,
      audit: {provenance: "CreateTimeline@1", integrity_digest: sha256(eventWithoutDigest)},
    };
    await this.#repository.commit(timeline, event, command.operation_id, {fingerprint, event});
    return structuredClone(event);
  }

  async getTimeline(organizationId: string, timelineId: string): Promise<TimelineView> {
    const timeline = await this.#repository.find(timelineId);
    if (!timeline || timeline.organizationId !== organizationId) throw new OnyxError("NOT_FOUND", "timeline not found");
    return toTimelineView(timeline);
  }

  async listTimelines(organizationId: string): Promise<TimelineView[]> {
    return (await this.#repository.list(organizationId)).map(toTimelineView);
  }

  async getHistory(organizationId: string, timelineId: string, afterVersion = 0, limit = 100): Promise<TimelineCreatedEvent[]> {
    await this.getTimeline(organizationId, timelineId);
    if (!Number.isInteger(afterVersion) || afterVersion < 0 || !Number.isInteger(limit) || limit < 1 || limit > 1_000) {
      throw new OnyxError("INVALID_ARGUMENT", "history bounds are invalid");
    }
    return this.#repository.history(timelineId, afterVersion, limit);
  }
}
